import { randomUUID } from 'node:crypto';
import { kube, run, patchResource, poll } from './runtime.mjs';

const registryClient = String.raw`
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  try {
    const { method, path } = JSON.parse(input);
    const response = await fetch('http://kubero-registry.kubero.svc.cluster.local:5000/v2/' + path, {
      method, headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json' },
      signal: AbortSignal.timeout(15000),
    });
    console.log(JSON.stringify({ status: response.status, digest: response.headers.get('docker-content-digest'), next: response.headers.get('link'), body: method === 'HEAD' ? '' : await response.text() }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
});`;

export function imageRepository(image) {
  return image.split('@')[0].replace(/:[^/:]+$/, '');
}

export function referencedImages(value) {
  if (!value || typeof value !== 'object') return [];
  const images = [];
  for (const [key, field] of Object.entries(value)) {
    if (key === 'image' && typeof field === 'string') images.push(field);
    if (key === 'image' && field?.repository) images.push(`${field.repository}:${field.tag || 'latest'}`);
    if (field && typeof field === 'object') images.push(...referencedImages(field));
  }
  return images;
}

export async function removeLocalImages(repository, { k = kube('k3d-atlas'), runner = run } = {}) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(repository)) throw new Error('Repositorio de imagen inválido.');
  const service = await k.json(['get', 'service', 'kubero-registry', '-n', 'kubero']);
  const registry = `${service.spec.clusterIP}:5000`;
  const repositories = new Set([`${registry}/${repository}`, `docker.io/atlas/${repository}`, `atlas/${repository}`]);
  for (const resource of ['pods', 'deployments', 'replicasets', 'statefulsets', 'daemonsets', 'jobs', 'cronjobs', 'kuberoapps', 'kuberobuilds']) {
    const objects = await k.json(['get', resource, '-A']);
    for (const object of objects.items) {
      if (referencedImages(object.spec).some(image => repositories.has(imageRepository(image)))) {
        throw new Error(`La imagen sigue referenciada por ${resource}/${object.metadata.name} en ${object.metadata.namespace}.`);
      }
    }
  }
  const nodes = (await k.json(['get', 'nodes'])).items;
  const cached = [];
  for (const node of nodes) {
    if (!/^k3d-atlas-(server|agent)-\d+$/.test(node.metadata.name)) throw new Error('La limpieza local requiere nodos del clúster k3d atlas.');
    const inventory = JSON.parse((await runner('docker', ['exec', node.metadata.name, 'crictl', 'images', '--output', 'json'])).stdout);
    for (const image of inventory.images) {
      if (!(image.repoTags || []).some(tag => repositories.has(imageRepository(tag)))) continue;
      if (image.repoTags.some(tag => !repositories.has(imageRepository(tag)))) throw new Error('La imagen comparte una referencia con otro repositorio; requiere revisión antes de borrarse.');
      cached.push({ node: node.metadata.name, image });
    }
  }
  const registryRequest = async (method, path) => JSON.parse(await k(['exec', '-i', 'deployment/kubero', '-n', 'kubero', '--', 'node', '-e', registryClient], { input: JSON.stringify({ method, path }) }));
  const tags = await registryRequest('GET', `${repository}/tags/list?n=10000`);
  if (tags.next) throw new Error('El repositorio contiene más etiquetas de las que puede verificar esta limpieza.');
  if (![200, 404].includes(tags.status)) throw new Error(`No se pudo consultar el registro (${tags.status}).`);
  const listing = tags.status === 200 ? JSON.parse(tags.body) : { tags: [] };
  const digests = new Set();
  for (const tag of listing.tags || []) {
    const manifest = await registryRequest('HEAD', `${repository}/manifests/${encodeURIComponent(tag)}`);
    if (manifest.status !== 200 || !/^sha256:[a-f0-9]{64}$/.test(manifest.digest || '')) throw new Error('No se pudo identificar el manifiesto de la imagen.');
    digests.add(manifest.digest);
  }
  if (digests.size) {
    const deployment = await k.json(['get', 'deployment', 'kubero-registry', '-n', 'kubero']);
    if (!deployment.spec.template.spec.containers.find(container => container.name === 'registry')?.env?.some(variable => variable.name === 'REGISTRY_STORAGE_DELETE_ENABLED' && variable.value === 'true')) {
      await patchResource(k, ['deployment', 'kubero-registry', '-n', 'kubero'], { spec: { template: { spec: { containers: [{ name: 'registry', env: [{ name: 'REGISTRY_STORAGE_DELETE_ENABLED', value: 'true' }] }] } } } }, 'strategic');
      await k(['rollout', 'status', 'deployment/kubero-registry', '-n', 'kubero', '--timeout=120s']);
    }
    for (const digest of digests) {
      const result = await registryRequest('DELETE', `${repository}/manifests/${digest}`);
      if (![202, 404].includes(result.status)) throw new Error(`El registro no confirmó el borrado de la imagen (${result.status}).`);
      const check = await registryRequest('HEAD', `${repository}/manifests/${digest}`);
      if (check.status !== 404) throw new Error('El manifiesto sigue accesible en el registro.');
    }
  }
  for (const { node, image } of cached) {
    await runner('docker', ['exec', node, 'crictl', '--timeout=60s', 'rmi', image.id]);
    const inventory = JSON.parse((await runner('docker', ['exec', node, 'crictl', 'images', '--output', 'json'])).stdout);
    if (inventory.images.some(candidate => candidate.id === image.id)) throw new Error('La imagen sigue en la caché de K3s.');
  }
  await poll(async () => {
    const result = await registryRequest('GET', `${repository}/tags/list?n=10000`);
    return result.status === 404 || (result.status === 200 && !(JSON.parse(result.body).tags || []).length);
  }, { timeout: 20000, message: 'El registro todavía contiene etiquetas de la imagen.' });
  // Stop the registry during collection; concurrent uploads could otherwise
  // lose layers that have not yet been attached to a published manifest.
  const deployment = await k.json(['get', 'deployment', 'kubero-registry', '-n', 'kubero']);
  const replicas = deployment.spec.replicas ?? 1;
  const template = deployment.spec.template.spec;
  const container = template.containers.find(container => container.name === 'registry');
  const selector = Object.entries(deployment.spec.selector.matchLabels).map(([name, value]) => `${name}=${value}`).join(',');
  const job = `atlas-registry-gc-${randomUUID().slice(0, 8)}`;
  try {
    await k(['scale', 'deployment/kubero-registry', '-n', 'kubero', '--replicas=0']);
    await k(['wait', '--for=delete', 'pod', '-n', 'kubero', '-l', selector, '--timeout=120s']);
    await k.apply({ apiVersion: 'batch/v1', kind: 'Job', metadata: { name: job, namespace: 'kubero' }, spec: {
      backoffLimit: 0, activeDeadlineSeconds: 180, ttlSecondsAfterFinished: 600,
      template: { spec: { restartPolicy: 'Never', automountServiceAccountToken: false, volumes: template.volumes, securityContext: template.securityContext,
        containers: [{ name: 'gc', image: container.image, imagePullPolicy: 'IfNotPresent', command: ['/bin/registry'], args: ['garbage-collect', '/etc/docker/registry/config.yml'], volumeMounts: container.volumeMounts, env: container.env }] } },
    } });
    await poll(async () => {
      const current = await k.json(['get', 'job', job, '-n', 'kubero']);
      if (current.status?.failed || current.status?.conditions?.some(condition => condition.type === 'Failed' && condition.status === 'True')) throw new Error('Falló la recolección de capas del registro.');
      return current.status?.succeeded > 0;
    }, { timeout: 200000, message: 'No se confirmó la recolección de capas del registro.' });
  } finally {
    try { await k(['delete', 'job', job, '-n', 'kubero', '--ignore-not-found', '--wait=true', '--timeout=120s']); }
    finally {
      await k(['scale', 'deployment/kubero-registry', '-n', 'kubero', `--replicas=${replicas}`]);
      if (replicas) await k(['rollout', 'status', 'deployment/kubero-registry', '-n', 'kubero', '--timeout=120s']);
    }
  }
  return { repository, manifests: digests.size, cachedImages: cached.length };
}
