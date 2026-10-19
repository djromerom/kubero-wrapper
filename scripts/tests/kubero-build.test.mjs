import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getBuildSpec, getBuildEnvironment, buildImage } from '../kubero-build.mjs';
import { getClusterSettings } from '../cluster-settings.mjs';
import { removeInside } from '../runtime.mjs';

test('Kubero fija el SHA, separa adaptación y conserva Dockerfile y puerto del registro', () => {
  const sha = 'a'.repeat(40);
  const spec = getBuildSpec('adapt-fixture', sha, 'https://github.com/example/app', 'registry.example:443/atlas/app:commit-tag', '12345678', 'nixpacks');
  assert.equal(spec.kind, 'KuberoBuild'); assert.equal(spec.spec.git.ref, sha); assert.equal(spec.metadata.namespace, 'atlasbuild-adaptation');
  assert.deepEqual(spec.spec.repository, { image: 'registry.example:443/atlas/app', tag: 'commit-tag' });
  assert.equal(spec.spec.dockerfile.path, '.nixpacks/Dockerfile');
  assert.equal(getBuildSpec('fixture', sha, 'repo', 'registry/app:tag', 'id', 'dockerfile', 'dockerfile').spec.dockerfile.path, 'dockerfile');
  assert.throws(() => getBuildSpec('app', 'main', 'repo', 'registry/app:tag', 'id', 'nixpacks'));
  assert.throws(() => getBuildSpec('app', sha, 'repo', 'registry:443/app', 'id', 'nixpacks'));
});

test('buildpacks: respeta valores del proyecto y distingue estático, SSR y Next.js', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-build-env-'));
  const manifest = pkg => writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  try {
    await manifest({ scripts: { build: 'vite build' }, devDependencies: { vite: '6' } });
    const env = await getBuildEnvironment(root, { build_env: { BP_WEB_SERVER_ROOT: 'custom' } });
    assert.deepEqual(env, { BP_NODE_RUN_SCRIPTS: 'build', BP_WEB_SERVER: 'nginx', BP_WEB_SERVER_ROOT: 'custom', BP_WEB_SERVER_ENABLE_PUSH_STATE: 'true' });
    await writeFile(join(root, 'vite.config.ts'), 'export default { ssr: {} }');
    assert.equal((await getBuildEnvironment(root)).BP_WEB_SERVER, undefined);
    await manifest({ scripts: { build: 'next build', start: 'next start' }, dependencies: { next: '15' } });
    assert.deepEqual(await getBuildEnvironment(root), { BP_NODE_RUN_SCRIPTS: 'build' });
  } finally { await removeInside(tmpdir(), root); }
});

test('un fallo del constructor no publica éxito y limpia sus recursos temporales', async () => {
  const resources = [], deletions = [];
  const k = async args => {
    if (args[0] === 'delete') deletions.push(args);
    if (args[0] === 'logs') return 'compilation failed';
    return 'exists';
  };
  k.apply = async resource => resources.push(resource);
  k.json = async args => {
    if (args[1] === 'nodes') return { items: [{ status: { nodeInfo: { architecture: 'amd64' }, conditions: [{ type: 'Ready', status: 'True' }] } }] };
    if (args[1] === 'deployment') return { spec: { template: { metadata: { annotations: { 'atlas.dev/build-contract': '2' } } } } };
    if (args[1] === 'job') return { status: { failed: 1 } };
    if (args[1] === 'pods') return { items: [] };
    throw new Error(`Consulta inesperada: ${args}`);
  };
  const settings = getClusterSettings({ ATLAS_IMAGE_DELIVERY: 'registry', ATLAS_IMAGE_REGISTRY: 'registry.test/atlas', ATLAS_KUBE_CONTEXT: 'test', ATLAS_DOMAIN_SUFFIX: 'apps.test' });
  // Registry setup needs the source pull secret; include the real Secret contract.
  const json = k.json;
  k.json = args => args[1] === 'secret' ? Promise.resolve({ data: { '.dockerconfigjson': 'encoded' } }) : json(args);
  await assert.rejects(buildImage({ settings, slug: 'fixture', commit: 'a'.repeat(40), repository: 'repo', strategy: 'buildpacks', configuration: { build_env: { TEST_VALUE: 'value' } } }, { k, env: {} }), /ATLAS_CORRECTION/);
  const app = resources.find(r => r.kind === 'KuberoApp');
  assert.equal(app.spec.web.replicaCount, 0); assert.equal(app.spec.ingress.enabled, false);
  assert.equal(deletions.length, 3); assert.ok(deletions.every(args => args.includes('atlasbuild-adaptation')));
});

test('K3s importa la imagen construida en todos los nodos antes del despliegue local', async () => {
  const calls = [];
  const nodes = ['k3d-atlas-server-0', 'k3d-atlas-agent-0'].map(name => ({ metadata: { name }, status: { nodeInfo: { architecture: 'amd64' }, conditions: [{ type: 'Ready', status: 'True' }] } }));
  const k = async () => 'exists';
  k.apply = async () => {};
  k.json = async args => {
    if (args[1] === 'nodes') return { items: nodes };
    if (args[1] === 'node') return nodes[0];
    if (args[1] === 'service') return { spec: { clusterIP: '10.43.10.20' } };
    if (args[1] === 'deployment') return { spec: { template: { metadata: { annotations: { 'atlas.dev/build-contract': '2' } } } } };
    if (args[1] === 'job') return { status: { succeeded: 1 } };
    if (args[1] === 'pods') return { items: [{ metadata: { name: 'build-pod' }, spec: { nodeName: nodes[0].metadata.name }, status: {} }] };
    throw new Error(`Consulta inesperada: ${args}`);
  };
  const runner = async (command, args) => {
    calls.push({ command, args });
    return { stdout: args.includes('inspecti') ? JSON.stringify({ info: { imageSpec: { architecture: 'amd64' } } }) : '' };
  };
  const result = await buildImage({ settings: getClusterSettings({}), slug: 'fixture', commit: 'a'.repeat(40), repository: 'repo', strategy: 'dockerfile' }, { k, runner, env: {} });
  assert.ok(result.Image.startsWith('10.43.10.20:5000/fixture:'));
  for (const { metadata } of nodes) {
    assert.ok(calls.some(({ command, args }) => command === 'docker' && args[1] === metadata.name && args.includes('ctr') && args.includes('--plain-http') && args.includes(result.Image)));
    assert.ok(calls.some(({ args }) => args[1] === metadata.name && args.includes('crictl') && args.includes('inspecti')));
  }
});
