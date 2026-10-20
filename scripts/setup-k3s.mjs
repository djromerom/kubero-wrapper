import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { cli, localDir, repoRoot, run, kube, poll, patchResource } from './runtime.mjs';
import { getClusterSettings, k3dCommand } from './cluster-settings.mjs';
import { installBuilder } from './install-kubero-builder.mjs';
import { startK3d } from './start-k3d.mjs';

export async function connectK3s() {
  await mkdir(localDir, { recursive: true });
  const file = join(localDir, 'k3s.kubeconfig');
  const config = await run(k3dCommand(), ['kubeconfig', 'get', 'atlas']);
  await writeFile(file, config.stdout, { mode: 0o600 });
  process.env.KUBECONFIG = file;
  return kube('k3d-atlas');
}

export async function exposeK3s() {
  const inspection = JSON.parse((await run('docker', ['inspect', 'k3d-atlas-serverlb'])).stdout)[0];
  for (const port of [80, 443]) {
    if (!inspection.HostConfig.PortBindings?.[`${port}/tcp`]?.some(binding => binding.HostPort === String(port))) {
      await run(k3dCommand(), ['cluster', 'edit', 'atlas', '--port-add', `${port}:${port}@loadbalancer`], { live: true });
    }
  }
}

export async function setupK3s({ expose = true } = {}) {
  await run('docker', ['info']);
  const clusters = JSON.parse((await run(k3dCommand(), ['cluster', 'list', '-o', 'json'])).stdout);
  if (clusters.some(cluster => cluster.name === 'atlas')) await startK3d();
  else await run(k3dCommand(), ['cluster', 'create', '--config', join(repoRoot, 'infra/k3d.yaml')], { live: true });
  const k = await connectK3s();
  await k(['wait', '--for=condition=Ready', 'node', '--all', '--timeout=180s']);
  await poll(() => k(['get', 'deployment', 'traefik', '-n', 'kube-system', '--ignore-not-found', '-o', 'name']), { timeout: 180_000, message: 'K3s no instaló Traefik.' });
  await k(['rollout', 'status', 'deployment/traefik', '-n', 'kube-system', '--timeout=180s'], { live: true });
  const installed = await k(['get', 'crd', 'kuberoapps.application.kubero.dev', '--ignore-not-found', '-o', 'name']);
  if (!installed) {
    await k(['apply', '-f', 'https://raw.githubusercontent.com/kubero-dev/kubero-operator/v0.2.2/deploy/operator.yaml'], { live: true });
    await k(['wait', '--for=condition=Established', 'crd/kuberoapps.application.kubero.dev', '--timeout=120s']);
    const deployment = await k.json(['get', 'deployment', 'kubero-operator-controller-manager', '-n', 'kubero-operator-system']);
    // The pinned upstream manifest includes an unavailable legacy metrics proxy.
    const containers = deployment.spec.template.spec.containers.filter(container => container.name !== 'kube-rbac-proxy');
    await patchResource(k, ['deployment', 'kubero-operator-controller-manager', '-n', 'kubero-operator-system'], { spec: { template: { spec: { containers } } } });
  }
  const settings = getClusterSettings();
  if (settings.Context !== 'k3d-atlas' || settings.Delivery !== 'k3d') throw new Error('Este instalador requiere ATLAS_IMAGE_DELIVERY=k3d y el contexto k3d-atlas.');
  const operator = await k.json(['get', 'deployment', 'kubero-operator-controller-manager', '-n', 'kubero-operator-system']);
  if (operator.spec.template.metadata.annotations?.['atlas.dev/build-contract'] !== '2') await installBuilder(settings.Context, settings);
  await k(['rollout', 'status', 'deployment/kubero-operator-controller-manager', '-n', 'kubero-operator-system', '--timeout=180s'], { live: true });
  await k.apply({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'kubero' } });
  if (!await k(['get', 'secret', 'kubero-secrets', '-n', 'kubero', '--ignore-not-found', '-o', 'name'])) {
    await k.apply({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'kubero-secrets', namespace: 'kubero' }, type: 'Opaque', stringData: { KUBERO_WEBHOOK_SECRET: randomBytes(20).toString('hex'), KUBERO_SESSION_KEY: randomBytes(32).toString('hex') } });
  }
  if (!await k(['get', 'kubero', 'kubero', '-n', 'kubero', '--ignore-not-found', '-o', 'name'])) {
    const sample = JSON.parse(await k(['create', '--dry-run=client', '-n', 'kubero', '-f', 'https://raw.githubusercontent.com/kubero-dev/kubero-operator/v0.2.2/config/samples/application_v1alpha1_kubero.yaml', '-o', 'json']));
    sample.metadata.namespace = 'kubero';
    sample.spec.ingress.enabled = false;
    sample.spec.kubero.database = { ...sample.spec.kubero.database, storageClassName: 'local-path', accessModes: ['ReadWriteOnce'], size: '1Gi' };
    Object.assign(sample.spec.registry, { enabled: true, create: true, storageClassName: 'local-path', host: 'registry.app.127.0.0.1.sslip.io' });
    await k.apply(sample);
  }
  await poll(() => k(['get', 'deployment', 'kubero', '-n', 'kubero', '--ignore-not-found', '-o', 'name']), { timeout: 180_000 });
  // Upstream v0.2.2 has immediate liveness checks; allow the UI to finish starting.
  await patchResource(k, ['deployment', 'kubero', '-n', 'kubero'], { spec: { template: { spec: { containers: [{ name: 'kubero', startupProbe: { httpGet: { path: '/', port: 'http' }, periodSeconds: 5, timeoutSeconds: 3, failureThreshold: 60 } }] } } } }, 'strategic');
  await k(['rollout', 'status', 'deployment/kubero', '-n', 'kubero', '--timeout=300s'], { live: true });
  if (expose) await exposeK3s();
  console.log('K3s preparado. Contexto: k3d-atlas; kubeconfig: .local/k3s.kubeconfig.');
}

cli(import.meta.url, 'node scripts/setup-k3s.mjs [--without-ingress-ports]', args => setupK3s({ expose: !args['without-ingress-ports'] }));
