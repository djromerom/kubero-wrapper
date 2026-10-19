import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cli, localDir, repoRoot, run, kube, poll, startBackground, alive, sleep } from './runtime.mjs';
import { installBuilder } from './install-kubero-builder.mjs';
import { getClusterSettings, k3dCommand } from './cluster-settings.mjs';
import { connectK3s } from './setup-k3s.mjs';

export async function startLocal({ buildBackend = false } = {}) {
  await run('docker', ['info']);
  const settings = getClusterSettings();
  if (!['kind', 'k3d'].includes(settings.Delivery)) throw new Error('Para clústeres remotos utiliza compose.cluster.yaml.');
  let k, node;
  if (settings.Delivery === 'k3d') {
    await run(k3dCommand(), ['cluster', 'start', 'atlas'], { live: true });
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
  const operator = await k.json(['get', 'deployment', 'kubero-operator-controller-manager', '-n', 'kubero-operator-system']);
  if (operator.spec.template.metadata.annotations?.['atlas.dev/build-contract'] !== '2') await installBuilder(settings.Context, settings);
  const config = await k.json(['config', 'view', '--raw', '--minify']);
  const cluster = config.clusters?.[0]?.cluster;
  if (!cluster || !/^https:\/\/127\.0\.0\.1:\d+$/.test(cluster.server)) throw new Error('Se esperaba un API del laboratorio local.');
  cluster.server = `https://${node}:6443`;
  cluster['tls-server-name'] = '127.0.0.1';
  await mkdir(localDir, { recursive: true });
  // JSON is a valid kubeconfig and avoids shell-dependent YAML editing.
  await writeFile(join(localDir, 'kubeconfig'), JSON.stringify(config), { mode: 0o600 });
  await run('docker', ['compose', '-f', join(repoRoot, 'compose.yaml'), '-f', join(repoRoot, 'compose.kubero.yaml'), 'up', '-d', ...(buildBackend ? ['--build'] : []), 'backend'], { live: true });
  await poll(async () => { try { const r = await fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(3000) }); return r.ok && (await r.json()).status === 'ok'; } catch { return false; } }, { timeout: 30_000, interval: 1000, message: 'El backend no respondió. Revisa docker compose logs backend.' });
  const frontendReady = async () => { try { const r = await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(3000) }); await r.body?.cancel(); return r.status === 200; } catch { return false; } };
  if (!await frontendReady()) await startBackground(join(repoRoot, 'frontend/node_modules/vite/bin/vite.js'), ['--host', '127.0.0.1'], 'vite', { cwd: join(repoRoot, 'frontend') });
  await poll(frontendReady, { timeout: 30_000, interval: 1000, message: 'El frontend no respondió. Revisa .local/vite.err.log.' });
  let worker;
  try { worker = JSON.parse(await readFile(join(localDir, 'deploy-worker.lock/owner.json'), 'utf8')); } catch {}
  if (!alive(worker?.pid)) {
    const pid = await startBackground(join(repoRoot, 'scripts/watch-local-deployments.mjs'), [], 'deploy-worker');
    await writeFile(join(localDir, 'deploy-worker.pid'), String(pid));
    await sleep(1000);
    if (!alive(pid)) throw new Error('No se pudo iniciar el monitor. Revisa .local/deploy-worker.err.log.');
  }
  console.log('Demo lista: http://127.0.0.1:5173/. Los proyectos aprobados se despliegan automáticamente.');
}

cli(import.meta.url, 'node scripts/start-local-kubero.mjs [--build-backend]', args => startLocal({ buildBackend: args['build-backend'] === true }));
