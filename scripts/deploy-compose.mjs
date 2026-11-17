import { randomUUID } from 'node:crypto';
import { poll, run } from './runtime.mjs';
import { publishImage } from './cluster-settings.mjs';
import { copyRegistrySecret } from './kubero-build.mjs';

export const composeNamespace = id => 'atlas-c-' + id;

async function buildService(service, { slug, sha, settings }) {
  const image = settings.Repository + '/' + slug + ':' + sha.slice(0, 12) + '-' + randomUUID().slice(0, 8);
  const { target, args, dockerfile, context } = service.build;
  const flags = Object.entries(args).flatMap(([key, value]) => ['--build-arg', key + '=' + value]);
  if (target) flags.push('--target', target);
  await run('docker', ['build', '--platform', settings.Platform, '-t', image, '-f', dockerfile, ...flags, context], { live: true });
  try { await publishImage(image, settings); }
  finally { await run('docker', ['image', 'rm', image], { allowFailure: true }); }
  return image;
}

export async function deployCompose(plan, { id, slug, sha, domain, configuration, settings, k, build = buildService }) {
  const namespace = composeNamespace(id);
  const labels = { 'atlas-project': slug };
  const desired = new Map();
  const apply = async (apiVersion, kind, name, fields, extraLabels = {}) => {
    if (!desired.has(kind)) desired.set(kind, new Set());
    desired.get(kind).add(name);
    await k.apply({ apiVersion, kind, metadata: { name, namespace, labels: { ...labels, ...extraLabels } }, ...fields });
  };
  const existing = await k.json(['get', 'namespace', namespace, '--ignore-not-found']);
  if (existing && existing.metadata.labels?.['atlas-project-id'] !== id) throw new Error('El namespace Compose ya pertenece a otro proyecto.');
  const images = new Map();
  for (const service of plan.services) images.set(service.name, service.build ? await build(service, { slug, sha, settings }) : service.image);
  await k.apply({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: namespace, labels: { ...labels, 'atlas-project-id': id, 'pod-security.kubernetes.io/enforce': 'baseline' } } });
  if (settings.ImagePullSecret) await copyRegistrySecret(k, namespace, settings.ImagePullSecret);
  for (const volume of plan.volumes) {
    await apply('v1', 'PersistentVolumeClaim', volume, { spec: { accessModes: ['ReadWriteOnce'], storageClassName: settings.StorageClass, resources: { requests: { storage: settings.StorageSize } } } });
  }
  let webPort;
  for (const s of plan.services) {
    const selector = { ...labels, 'atlas-service': s.name };
    const ports = [...new Set([...s.published, ...s.exposed])];
    if (s.name === plan.web) {
      webPort = ports[0] ?? configuration.port ?? 3000;
      if (!ports.length) ports.push(webPort);
    }
    // Headless services also resolve by Compose name when no ports were declared.
    await apply('v1', 'Service', s.name, { spec: { clusterIP: 'None', selector,
      ports: ports.map(port => ({ name: 'tcp-' + port, port, targetPort: port })) } });
  }
  for (const s of plan.services) {
    const selector = { ...labels, 'atlas-service': s.name };
    const volumes = [], volumeMounts = [];
    for (const dep of s.depends) {
      await k(['rollout', 'status', 'deployment/' + dep, '-n', namespace, '--timeout=240s'], { live: true });
    }
    for (const [index, mount] of s.mounts.entries()) {
      const name = 'mount-' + index;
      if (mount.volume) {
        volumes.push({ name, persistentVolumeClaim: { claimName: mount.volume } });
        volumeMounts.push({ name, mountPath: mount.to, readOnly: mount.readOnly });
      } else {
        const source = 'files-' + plan.services.indexOf(s) + '-' + index;
        const items = mount.entries.map((entry, i) => ({ key: 'file-' + i, path: entry.path }));
        await apply('v1', 'Secret', source, { data: Object.fromEntries(mount.entries.map((entry, i) => [items[i].key, entry.data])) });
        volumes.push({ name, secret: { secretName: source, items } });
        volumeMounts.push({ name, mountPath: mount.to, readOnly: true, subPath: mount.single ? items[0].path : undefined });
      }
    }
    const values = { ...s.environment, ...(s.name === plan.web ? configuration.runtime_env : {}) };
    const envSecret = 'env-' + plan.services.indexOf(s);
    await apply('v1', 'Secret', envSecret, { stringData: values });
    const container = { name: s.name, image: images.get(s.name), imagePullPolicy: s.build ? settings.PullPolicy : 'IfNotPresent',
      command: s.command, args: s.args, workingDir: s.workingDir, volumeMounts, envFrom: [{ secretRef: { name: envSecret } }],
      securityContext: { allowPrivilegeEscalation: false }, resources: { limits: { cpu: '1', memory: '1Gi' } } };
    container.readinessProbe = s.readinessProbe ?? (s.name === plan.web ? { httpGet: { port: webPort, path: configuration.health_path || '/' } } : undefined);
    await apply('apps/v1', 'Deployment', s.name, { spec: { replicas: 1, strategy: { type: 'Recreate' }, selector: { matchLabels: selector },
      template: { metadata: { labels: selector, annotations: { 'atlas.dev/revision': sha, 'atlas.dev/attempt': randomUUID() } }, spec: {
        automountServiceAccountToken: false, enableServiceLinks: false, volumes, containers: [container],
        imagePullSecrets: settings.ImagePullSecret ? [{ name: settings.ImagePullSecret }] : undefined } } } });
  }
  for (const s of plan.services) await k(['rollout', 'status', 'deployment/' + s.name, '-n', namespace, '--timeout=240s'], { live: true });
  await apply('networking.k8s.io/v1', 'Ingress', 'web', { spec: { ingressClassName: settings.IngressClass,
    rules: [{ host: domain, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: plan.web, port: { number: webPort } } } }] } }] } });
  for (const kind of ['Deployment', 'Service', 'Secret']) {
    const resources = await k.json(['get', kind, '-n', namespace, '-l', 'atlas-project=' + slug]);
    for (const item of resources.items) if (!desired.get(kind)?.has(item.metadata.name)) {
      await k(['delete', kind, item.metadata.name, '-n', namespace, '--ignore-not-found']);
    }
  }
  return { image: images.get(plan.web), port: webPort };
}

export async function verifyPage(url, fetcher = fetch) {
  await poll(async () => {
    try {
      const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      await response.body?.cancel();
      return response.status >= 200 && response.status < 400;
    } catch { return false; }
  }, { interval: 3000, message: 'La aplicación aún no responde en ' + url });
}
