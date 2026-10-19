import { randomBytes } from 'node:crypto';
import { getClusterSettings } from './cluster-settings.mjs';
import { kube, poll, sleep } from './runtime.mjs';

export function createProjectServices(settings = getClusterSettings(), k = kube(settings.Context), env = process.env) {
  async function apply(manifest) {
    if (settings.StorageClass && manifest.kind === 'PersistentVolumeClaim') manifest.spec.storageClassName = settings.StorageClass;
    if (settings.ImagePullSecret && ['Deployment', 'Job'].includes(manifest.kind)) manifest.spec.template.spec.imagePullSecrets = [{ name: settings.ImagePullSecret }];
    return k.apply(manifest);
  }
  async function initialize(slug, config, namespace = 'atlas-production') {
    const values = { PORT: String(config.port), HOST: '0.0.0.0', NODE_ENV: 'production', ...Object.fromEntries(Object.entries(config.runtime_env || {}).map(([k, v]) => [k, String(v)])) };
    for (const service of ['postgres', 'redis']) {
      const name = `${slug}-${service}`, metadata = { name, namespace, labels: { 'atlas-project': slug, 'atlas-service': service } }, labels = metadata.labels;
      if (!config[service]) {
        if (await k(['get', 'deployment', name, '-n', namespace, '--ignore-not-found', '-o', 'name'])) await k(['scale', `deployment/${name}`, '-n', namespace, '--replicas=0']);
        continue;
      }
      const port = service === 'postgres' ? 5432 : 6379;
      const container = { name: service, image: service === 'postgres' ? 'postgres:16-bookworm' : 'redis:7-bookworm', ports: [{ containerPort: port }], resources: { requests: { cpu: '50m', memory: '64Mi' }, limits: { memory: '512Mi' } } };
      if (service === 'postgres') {
        const existing = await k.json(['get', 'secret', `${name}-credentials`, '-n', namespace, '--ignore-not-found']);
        const password = existing ? Buffer.from(existing.data.POSTGRES_PASSWORD, 'base64').toString('utf8') : randomBytes(32).toString('hex');
        await apply({ apiVersion: 'v1', kind: 'Secret', metadata: { ...metadata, name: `${name}-credentials` }, type: 'Opaque', stringData: { POSTGRES_USER: 'atlas', POSTGRES_DB: 'app', POSTGRES_PASSWORD: password } });
        await apply({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { ...metadata, name: `${name}-data` }, spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: settings.StorageSize } } } });
        container.envFrom = [{ secretRef: { name: `${name}-credentials` } }];
        container.env = [{ name: 'PGDATA', value: '/var/lib/postgresql/data/pgdata' }];
        container.volumeMounts = [{ name: 'data', mountPath: '/var/lib/postgresql/data' }];
        container.readinessProbe = { exec: { command: ['pg_isready', '-U', 'atlas', '-d', 'app'] }, initialDelaySeconds: 5, periodSeconds: 3, timeoutSeconds: 3 };
        values.DATABASE_URL = `postgresql://atlas:${encodeURIComponent(password)}@${name}:${port}/app?schema=public`;
      } else {
        container.args = ['--save', '', '--appendonly', 'no'];
        container.readinessProbe = { exec: { command: ['redis-cli', 'ping'] }, initialDelaySeconds: 2, periodSeconds: 3, timeoutSeconds: 3 };
        Object.assign(values, { REDIS_HOST: name, REDIS_PORT: String(port), REDIS_URL: `redis://${name}:${port}` });
      }
      const spec = { automountServiceAccountToken: false, containers: [container] };
      if (service === 'postgres') spec.volumes = [{ name: 'data', persistentVolumeClaim: { claimName: `${name}-data` } }];
      await apply({ apiVersion: 'apps/v1', kind: 'Deployment', metadata, spec: { replicas: 1, strategy: { type: 'Recreate' }, selector: { matchLabels: labels }, template: { metadata: { labels }, spec } } });
      await apply({ apiVersion: 'v1', kind: 'Service', metadata, spec: { selector: labels, ports: [{ port, targetPort: port }] } });
      console.log(`Esperando al servicio ${service}...`);
      try { await k(['rollout', 'status', `deployment/${name}`, '-n', namespace, '--timeout=300s'], { live: true }); }
      catch (error) {
        await k(['get', 'pods', '-n', namespace, '-l', `atlas-project=${slug},atlas-service=${service}`, '-o', 'wide'], { live: true, allowFailure: true });
        await k(['get', 'events', '-n', namespace, '--sort-by=.lastTimestamp'], { live: true, allowFailure: true });
        await k(['logs', `deployment/${name}`, '-n', namespace, '--all-containers=true', '--tail=50'], { live: true, allowFailure: true });
        throw error;
      }
    }
    return values;
  }
  const runtimeCommand = command => env.ATLAS_RUNTIME_BUILDPACKS === 'true' ? ['/cnb/lifecycle/launcher', '/bin/sh', '-c', command] : ['/bin/sh', '-c', command];
  const container = (name, image, command, values) => ({ name, image, imagePullPolicy: settings.PullPolicy, command: runtimeCommand(command), env: Object.entries(values).map(([name, value]) => ({ name, value: String(value) })) });
  async function migrate(slug, image, command = '', values, namespace = 'atlas-production') {
    if (!command.trim()) return;
    const name = `${slug}-migrate`, labels = { 'atlas-project': slug };
    await k(['delete', 'job', name, '-n', namespace, '--ignore-not-found', '--wait=true']);
    await apply({ apiVersion: 'batch/v1', kind: 'Job', metadata: { name, namespace, labels }, spec: { backoffLimit: 0, activeDeadlineSeconds: 180, ttlSecondsAfterFinished: 86400, template: { metadata: { labels }, spec: { restartPolicy: 'Never', automountServiceAccountToken: false, containers: [container('migration', image, command, values)] } } } });
    let job;
    try {
      job = await poll(async () => { const j = await k.json(['get', 'job', name, '-n', namespace]); return j.status?.succeeded > 0 || j.status?.failed > 0 ? j : null; }, { timeout: 190_000, message: 'La migración superó el tiempo disponible.' });
    } finally { await k(['logs', `job/${name}`, '-n', namespace, '--all-containers=true'], { live: true, allowFailure: true }); }
    if (job.status.succeeded !== 1) throw new Error('La migración no terminó correctamente. Revisa los logs antes de reintentarlo.');
  }
  async function setWorker(slug, image, command = '', values, namespace = 'atlas-production') {
    const name = `${slug}-background`;
    if (!command.trim()) { await k(['delete', 'deployment', name, '-n', namespace, '--ignore-not-found']); return; }
    const labels = { 'atlas-project': slug, 'atlas-service': 'worker' };
    const worker = { ...container('worker', image, command, values), resources: { requests: { cpu: '50m', memory: '64Mi' }, limits: { memory: '512Mi' } } };
    await apply({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name, namespace, labels }, spec: { replicas: 1, selector: { matchLabels: labels }, template: { metadata: { labels }, spec: { automountServiceAccountToken: false, containers: [worker] } } } });
    await k(['rollout', 'status', `deployment/${name}`, '-n', namespace, '--timeout=120s'], { live: true });
    await sleep(5000);
    const pods = await k.json(['get', 'pods', '-n', namespace, '-l', `atlas-project=${slug},atlas-service=worker`]);
    if (!pods.items.some(p => p.status?.containerStatuses?.[0]?.ready)) throw new Error('El worker se detuvo después de iniciar. Revisa sus logs.');
  }
  return { apply, initialize, migrate, setWorker };
}
