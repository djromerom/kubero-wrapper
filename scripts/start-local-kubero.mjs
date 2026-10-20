import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cli, localDir, repoRoot, run, kube, poll, startBackground, alive, sleep } from './runtime.mjs';
import { installBuilder } from './install-kubero-builder.mjs';
import { getClusterSettings } from './cluster-settings.mjs';
import { connectK3s } from './setup-k3s.mjs';
import { startK3d } from './start-k3d.mjs';

export async function startLocal({ build = false, buildBackend = false, withoutWorker = false } = {}) {
  build ||= buildBackend;
  await run('docker', ['info']);
  const settings = getClusterSettings();
  if (!['kind', 'k3d'].includes(settings.Delivery)) throw new Error('Para clústeres remotos utiliza compose.cluster.yaml.');
  let k, node;
  if (settings.Delivery === 'k3d') {
    await startK3d();
    k = await connectK3s();
    node = 'k3d-atlas-server-0';
    process.env.ATLAS_DOCKER_NETWORK = 'k3d-atlas';
  } else {
    node = 'kubero-control-plane';
    if ((await run('docker', ['ps', '-a', '--filter', `name=^/${node}$`, '--format', '{{.Names}}'])).stdout !== node) throw new Error('No existe el laboratorio Kind anterior.');
    if (!(await run('docker', ['ps', '--filter', `name=^/${node}$`, '--format', '{{.Names}}'])).stdout) await run('docker', ['start', node]);
    k = kube(settings.Context);
    process.env.ATLAS_DOCKER_NETWORK = 'kind';
  }
  await k(['wait', '--for=condition=Ready', 'node', '--all', '--timeout=120s']);
  await k(['get', 'crd', 'kuberoapps.application.kubero.dev']);
  if (settings.Delivery === 'k3d') await k(['rollout', 'status', 'deployment/traefik', '-n', 'kube-system', '--timeout=120s']);
  const operator = await k.json(['get', 'deployment', 'kubero-operator-controller-manager', '-n', 'kubero-operator-system']);
  if (operator.spec.template.metadata.annotations?.['atlas.dev/build-contract'] !== '2') await installBuilder(settings.Context, settings);
  await k(['rollout', 'status', 'deployment/kubero-operator-controller-manager', '-n', 'kubero-operator-system', '--timeout=180s']);
  await k(['rollout', 'status', 'deployment/kubero', '-n', 'kubero', '--timeout=300s']);
  const config = await k.json(['config', 'view', '--raw', '--minify']);
  const cluster = config.clusters?.[0]?.cluster;
  if (!cluster || !/^https:\/\/127\.0\.0\.1:\d+$/.test(cluster.server)) throw new Error('Se esperaba un API del laboratorio local.');
  cluster.server = `https://${node}:6443`;
  cluster['tls-server-name'] = '127.0.0.1';
  await mkdir(localDir, { recursive: true });
  // JSON is a valid kubeconfig and avoids shell-dependent YAML editing.
  await writeFile(join(localDir, 'kubeconfig'), JSON.stringify(config), { mode: 0o600 });
  const composeFiles = ['compose.yaml', 'compose.kubero.yaml', 'compose.dev.yaml'];
  const composeArgs = composeFiles.flatMap(file => ['-f', join(repoRoot, file)]);
  const buildArgs = build ? ['--build', '--renew-anon-volumes'] : [];
  await run('docker', ['compose', ...composeArgs, 'up', '-d', ...buildArgs, 'backend', 'frontend'], { live: true });
  await poll(async () => { try { const r = await fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(3000) }); return r.ok && (await r.json()).status === 'ok'; } catch { return false; } }, { timeout: 30_000, interval: 1000, message: 'El backend no respondió. Revisa docker compose logs backend.' });
  const frontendReady = async () => {
    try {
      const page = await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(3000) });
      await page.body?.cancel();
      if (!page.ok) return false;
      const api = await fetch('http://127.0.0.1:5173/api/health', { signal: AbortSignal.timeout(3000) });
      return api.ok && (await api.json()).status === 'ok';
    } catch {
      return false;
    }
  };
  await poll(frontendReady, { timeout: 60_000, interval: 1000, message: 'El frontend o su conexión con la API no respondió. Revisa docker compose logs frontend.' });
  if (withoutWorker) {
    console.log('Atlas disponible: http://localhost:5173/. El monitor de despliegues no se inicia en este arranque.');
    return;
  }
  let worker;
  try { worker = JSON.parse(await readFile(join(localDir, 'deploy-worker.lock/owner.json'), 'utf8')); } catch {}
  if (!alive(worker?.pid)) {
    const pid = await startBackground(join(repoRoot, 'scripts/watch-local-deployments.mjs'), [], 'deploy-worker');
    await writeFile(join(localDir, 'deploy-worker.pid'), String(pid));
    await sleep(1000);
    if (!alive(pid)) throw new Error('No se pudo iniciar el monitor. Revisa .local/deploy-worker.err.log.');
  }
  console.log('Atlas disponible: http://localhost:5173/. Monitor de despliegues activo.');
}

cli(import.meta.url, 'node scripts/start-local-kubero.mjs [--build] [--without-worker]', args => startLocal({ build: args.build === true || args['build-backend'] === true, withoutWorker: args['without-worker'] === true }));
