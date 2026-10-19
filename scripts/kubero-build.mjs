import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { kube, poll, run } from './runtime.mjs';

export async function getBuildEnvironment(sourceDir, configuration = {}) {
  const values = Object.fromEntries(Object.entries(configuration.build_env || {}).map(([k, v]) => [k, String(v)]));
  const defaults = {};
  if (existsSync(join(sourceDir, 'package.json'))) {
    const pkg = JSON.parse(await readFile(join(sourceDir, 'package.json'), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    if (pkg.scripts?.build) defaults.BP_NODE_RUN_SCRIPTS = 'build';
    let staticSite = deps.includes('react-scripts'), output = 'build';
    if (deps.some(d => ['vite', 'astro'].includes(d)) && !deps.includes('next') && !deps.includes('@nestjs/core')) {
      const configs = (await readdir(sourceDir)).filter(n => /^(vite|astro)\.config\./.test(n));
      const text = (await Promise.all(configs.map(n => readFile(join(sourceDir, n), 'utf8')))).join('\n');
      staticSite = !deps.includes('@astrojs/node') && !/output\s*:\s*['"](?:server|hybrid)|ssr\s*:/.test(text);
      output = 'dist';
    }
    if (staticSite) Object.assign(defaults, { BP_WEB_SERVER: 'nginx', BP_WEB_SERVER_ROOT: output, BP_WEB_SERVER_ENABLE_PUSH_STATE: 'true' });
  } else if (existsSync(join(sourceDir, 'index.html'))) Object.assign(defaults, { BP_WEB_SERVER: 'nginx', BP_WEB_SERVER_ROOT: '.' });
  return { ...defaults, ...values };
}

export function getBuildSpec(app, commit, repository, image, id, strategy, dockerfile = 'Dockerfile') {
  if (!['dockerfile', 'nixpacks', 'buildpacks'].includes(strategy)) throw new Error('Estrategia de Kubero no soportada.');
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('La construcción debe fijar un commit completo.');
  const split = image.lastIndexOf(':');
  if (split <= image.lastIndexOf('/')) throw new Error('La imagen debe tener una etiqueta explícita.');
  return { apiVersion: 'application.kubero.dev/v1alpha1', kind: 'KuberoBuild', metadata: { name: `${app}-atlasbuild-${id}`, namespace: 'atlasbuild-adaptation' }, spec: {
    app, pipeline: 'atlasbuild', phase: 'adaptation', id, buildstrategy: strategy, git: { url: repository, ref: commit }, repository: { image: image.slice(0, split), tag: image.slice(split + 1) },
    dockerfile: { path: strategy === 'nixpacks' ? '.nixpacks/Dockerfile' : dockerfile }, nixpack: { path: '.nixpacks/Dockerfile' }, buildpack: { path: '.', cnbPlatformApi: '0.13' }, podSecurityContext: { fsGroup: 1000 } } };
}

export async function copyRegistrySecret(k, namespace, name = 'kubero-pull-secret', env = process.env) {
  const secret = await k.json(['get', 'secret', env.ATLAS_KUBERO_REGISTRY_SECRET || 'registry-login', '-n', 'kubero']);
  if (!secret?.data?.['.dockerconfigjson']) throw new Error('Configura el secreto del registro de Kubero en el namespace kubero.');
  await k.apply({ apiVersion: 'v1', kind: 'Secret', metadata: { name, namespace }, type: 'kubernetes.io/dockerconfigjson', data: { '.dockerconfigjson': secret.data['.dockerconfigjson'] } });
}

export async function initializeBuild(settings, k = kube(settings.Context)) {
  await k(['get', 'crd', 'kuberobuilds.application.kubero.dev']);
  const architecture = settings.Platform.split('/')[1];
  const nodes = await k.json(['get', 'nodes']);
  if (!nodes.items.some(n => n.status.nodeInfo.architecture === architecture && n.status.conditions.some(c => c.type === 'Ready' && c.status === 'True'))) throw new Error(`Kubero requiere un nodo disponible para ${architecture}.`);
  const operator = await k.json(['get', 'deployment', 'kubero-operator-controller-manager', '-n', 'kubero-operator-system']);
  if (operator.spec.template.metadata.annotations?.['atlas.dev/build-contract'] !== '2') throw new Error('Prepara el constructor con node scripts/install-kubero-builder.mjs antes de adaptar.');
  let registry = settings.Repository;
  if (settings.Delivery !== 'registry') {
    let service = await k.json(['get', 'service', 'kubero-registry', '-n', 'kubero', '--ignore-not-found']);
    if (!service) {
      const cr = await k.json(['get', 'kubero', 'kubero', '-n', 'kubero']);
      Object.assign(cr.spec.registry, { enabled: true, create: true, host: 'registry.app.127.0.0.1.sslip.io', storageClassName: settings.StorageClass || 'standard' });
      await k.apply({ apiVersion: cr.apiVersion, kind: cr.kind, metadata: { name: 'kubero', namespace: 'kubero' }, spec: cr.spec });
      service = await poll(() => k.json(['get', 'service', 'kubero-registry', '-n', 'kubero', '--ignore-not-found']), { message: 'Habilita el registro nativo de Kubero antes de adaptar.' });
    }
    if (!service.spec.clusterIP) throw new Error('El registro nativo de Kubero no tiene dirección.');
    registry = `${service.spec.clusterIP}:5000`;
  }
  await k.apply({ apiVersion: 'application.kubero.dev/v1alpha1', kind: 'KuberoPipeline', metadata: { name: 'atlasbuild', namespace: 'kubero' }, spec: {
    name: 'atlasbuild', deploymentstrategy: 'git', buildstrategy: 'nixpacks', reviewapps: false,
    git: { provider: '', keys: { priv: '', pub: '' }, repository: { admin: false, ssh_url: '', clone_url: '' } }, registry: { createSecret: 'copy' }, phases: [{ name: 'adaptation', context: 'inClusterContext', enabled: true }] } });
  await poll(() => k(['get', 'namespace', 'atlasbuild-adaptation', '--ignore-not-found', '-o', 'name']), { message: 'Kubero no creó el namespace de construcción.' });
  if (!await k(['get', 'secret', 'deployment-keys', '-n', 'atlasbuild-adaptation', '--ignore-not-found', '-o', 'name'])) await k.apply({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'deployment-keys', namespace: 'atlasbuild-adaptation' }, type: 'Opaque', stringData: { deploykey: '', 'deploykey.pub': '' } });
  if (settings.Delivery === 'registry') await copyRegistrySecret(k, 'atlasbuild-adaptation');
  return registry;
}

export async function cacheLocalImage(image, settings, { k = kube(settings.Context), runner = run } = {}) {
  if (settings.Delivery === 'registry') return;
  // Load the verified image on every local node before a Never-pull deployment.
  const nodes = (await k.json(['get', 'nodes'])).items;
  console.log('Preparando la imagen para ejecutar la aplicación...');
  for (const node of nodes) {
    await runner('docker', ['exec', node.metadata.name, 'ctr', '--namespace', 'k8s.io', 'images', 'pull', '--plain-http', image]);
    const inspection = JSON.parse((await runner('docker', ['exec', node.metadata.name, 'crictl', 'inspecti', image])).stdout);
    if (inspection.info.imageSpec.architecture !== settings.Platform.split('/')[1]) throw new Error('ATLAS_CORRECTION: El Dockerfile produjo una imagen para una arquitectura diferente.');
  }
}

export async function buildImage({ settings, slug, commit, repository, strategy, dockerfile = 'Dockerfile', configuration = {}, gitToken }, { k = kube(settings.Context), runner = run, env = process.env } = {}) {
  const timeout = Number(env.ATLAS_KUBERO_BUILD_TIMEOUT_MINUTES || 30);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60) throw new Error('El tiempo de construcción debe ser de 1 a 60 minutos.');
  const registry = await initializeBuild(settings, k), id = randomUUID().replaceAll('-', '').slice(0, 8);
  const appName = `adapt-${slug}`, namespace = 'atlasbuild-adaptation', image = `${registry}/${slug}:${commit.slice(0, 12)}-${id}`;
  const spec = getBuildSpec(appName, commit, repository, image, id, strategy, dockerfile);
  Object.assign(spec.spec, { nodeSelector: { 'kubernetes.io/arch': settings.Platform.split('/')[1] }, registryTlsVerify: settings.Delivery === 'registry' ? 'true' : 'false' });
  spec.spec.buildpack.builder = env.ATLAS_KUBERO_CNB_BUILDER || 'paketobuildpacks/ubuntu-noble-builder:latest';
  if (settings.Delivery !== 'registry') spec.spec.insecureRegistry = registry;
  const buildSecret = `atlas-build-env-${id}`, gitSecret = `atlas-build-git-${id}`, jobName = spec.metadata.name;
  try {
    if (gitToken) {
      await k.apply({ apiVersion: 'v1', kind: 'Secret', metadata: { name: gitSecret, namespace }, type: 'Opaque', stringData: { token: gitToken } });
      spec.spec.gitCredentialsSecret = gitSecret;
    }
    const values = Object.fromEntries(Object.entries(configuration.build_env || {}).map(([name, value]) => {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new Error('ATLAS_CORRECTION: Nombre de variable de construcción inválido.');
      return [name, String(value)];
    }));
    if (Object.keys(values).length) {
      await k.apply({ apiVersion: 'v1', kind: 'Secret', metadata: { name: buildSecret, namespace }, type: 'Opaque', stringData: values });
      Object.assign(spec.spec, { buildEnvironmentSecret: buildSecret, buildEnvKeys: Object.keys(values) });
    }
    await k.apply({ apiVersion: 'application.kubero.dev/v1alpha1', kind: 'KuberoApp', metadata: { name: appName, namespace }, spec: {
      name: appName, pipeline: 'atlasbuild', phase: 'adaptation', deploymentstrategy: 'docker', buildstrategy: 'external', image: { repository: 'registry.k8s.io/pause', tag: '3.10', containerPort: 3000, pullPolicy: 'IfNotPresent' },
      web: { replicaCount: 0 }, worker: { replicaCount: 0 }, autoscaling: { enabled: false }, ingress: { enabled: false }, serviceAccount: { create: true } } });
    await poll(() => k(['get', 'serviceaccount', `${appName}-kuberoapp`, '-n', namespace, '--ignore-not-found', '-o', 'name']), { message: 'Kubero no creó la cuenta de servicio del constructor.' });
    await k.apply(spec);
    const seen = new Map();
    await poll(async () => {
      const job = await k.json(['get', 'job', jobName, '-n', namespace, '--ignore-not-found']);
      if (!job) return false;
      const pods = (await k.json(['get', 'pods', '-n', namespace, '-l', `job-name=${jobName}`])).items;
      const statuses = pods.flatMap(p => [...(p.status.initContainerStatuses || []), ...(p.status.containerStatuses || [])].map(c => ({ p, c })));
      for (const { p, c } of statuses) {
        if (c.state.running || c.state.terminated) {
          const key = `${p.metadata.name}/${c.name}`, previous = seen.get(key) || '';
          const logs = await k(['logs', p.metadata.name, '-n', namespace, '-c', c.name], { allowFailure: true });
          if (logs && logs !== previous) { console.log(logs.startsWith(previous) ? logs.slice(previous.length) : logs); seen.set(key, logs); }
        }
        if (['ImagePullBackOff', 'ErrImagePull', 'CreateContainerConfigError'].includes(c.state.waiting?.reason)) throw new Error(`El constructor de Kubero no pudo arrancar: ${c.state.waiting.reason}.`);
      }
      if (job.status?.succeeded) {
        if (!pods[0]?.spec.nodeName) throw new Error('No se pudo identificar el nodo constructor.');
        const node = await k.json(['get', 'node', pods[0].spec.nodeName]);
        if (node.status.nodeInfo.architecture !== settings.Platform.split('/')[1]) throw new Error('La arquitectura del nodo constructor no coincide con el informe.');
        return true;
      }
      if (job.status?.failed || job.status?.conditions?.some(c => c.type === 'Failed' && c.status === 'True')) {
        if (/cannot read file .* from tarball|Could not resolve host|Temporary failure in name resolution|TLS handshake timeout/.test([...seen.values()].join('\n'))) throw new Error('Kubero no pudo descargar dependencias de su constructor. Revisa conectividad y el motor seleccionado.');
        if (statuses.some(({ c }) => c.name === 'deploy' && c.state.terminated?.exitCode > 0)) throw new Error('Kubero construyó la imagen, pero su paso final no pudo registrar el resultado.');
        if (statuses.some(({ c }) => c.name === 'fetch' && c.state.terminated?.exitCode > 0)) throw new Error('Kubero no pudo descargar el repositorio fijado. Revisa conectividad y credenciales.');
        throw new Error('ATLAS_CORRECTION: Kubero no pudo empaquetar el proyecto. Revisa sus logs y proporciona o corrige el Dockerfile.');
      }
      return false;
    }, { timeout: timeout * 60_000, interval: 3000, message: 'La construcción de Kubero superó el tiempo disponible; revisa el clúster.' });
    await cacheLocalImage(image, settings, { k, runner });
    return { Image: image, Build: spec.metadata.name, Job: jobName, Namespace: namespace, Strategy: strategy };
  } finally {
    for (const args of [['kuberobuild', spec.metadata.name], ['kuberoapp', appName], ['secret', buildSecret, gitSecret]]) await k(['delete', ...args, '-n', namespace, '--ignore-not-found', '--wait=false'], { allowFailure: true });
  }
}
