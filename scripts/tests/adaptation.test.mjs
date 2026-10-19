import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAdaptationReport } from '../adaptation.mjs';
import { getClusterSettings } from '../cluster-settings.mjs';
import { removeInside } from '../runtime.mjs';

test('compatibilidad: componentes, servicios, runners, adaptadores y variables', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-adaptation-'));
  const fixture = async (name, pkg) => { const dir = join(root, name); await mkdir(dir, { recursive: true }); if (pkg) await writeFile(join(dir, 'package.json'), JSON.stringify(pkg)); return dir; };
  const config = { postgres: false, redis: false, runtime_env: {}, build_env: {}, migration_command: '' };
  try {
    const site = await fixture('astro', { scripts: { build: 'astro build' }, dependencies: { astro: '5' } });
    let report = await getAdaptationReport(site, config, 'a'.repeat(40), 'linux/arm64');
    assert.equal(report.outcome, 'adapted'); assert.equal(report.build_verified, false); assert.equal(report.runtime_verified, false);
    await fixture('astro/api', { scripts: { start: 'node index.js' } });
    report = await getAdaptationReport(site, config, 'sha', 'linux/arm64');
    assert.equal(report.components.length, 2); assert.equal(report.outcome, 'intervention_required');
    await fixture('astro/node_modules/ignored', { scripts: { start: 'fake' } });
    assert.equal((await getAdaptationReport(site, config, 'sha', 'linux/arm64')).components.length, 2);
    const api = await fixture('api', { scripts: { start: 'node index.js' }, dependencies: { pg: '8', bullmq: '5', dockerode: '5' } });
    assert.ok((await getAdaptationReport(api, config, 'sha', 'linux/amd64')).blockers.length >= 3);
    config.postgres = true; config.redis = true;
    assert.equal((await getAdaptationReport(api, config, 'sha', 'linux/amd64')).blockers.length, 1);
    const custom = await fixture('development');
    await writeFile(join(custom, 'Dockerfile'), 'FROM node:22\nCMD ["npm","run","start:dev"]');
    assert.equal((await getAdaptationReport(custom, config, 'sha', 'linux/amd64')).outcome, 'intervention_required');
    const cloud = await fixture('cloud', { scripts: { build: 'astro build' }, dependencies: { astro: '5', '@astrojs/vercel': '9' } });
    assert.equal((await getAdaptationReport(cloud, config, 'sha', 'linux/arm64')).outcome, 'intervention_required');
    await writeFile(join(custom, '.env.example'), 'PORT=3000\nMISSING_SECRET=\n');
    assert.ok((await getAdaptationReport(custom, config, 'sha', 'linux/amd64')).warnings.some(w => w.includes('MISSING_SECRET')));
    await writeFile(join(custom, 'package.json'), '{invalid');
    assert.ok((await getAdaptationReport(custom, config, 'sha', 'linux/amd64')).blockers.some(w => w.includes('JSON')));
  } finally { await removeInside(tmpdir(), root); }
});

test('configuración K3s local, Kind anterior y registro remoto', () => {
  assert.equal(getClusterSettings({}).Context, 'k3d-atlas');
  assert.equal(getClusterSettings({}).IngressClass, 'traefik');
  assert.equal(getClusterSettings({}).StorageClass, 'local-path');
  assert.equal(getClusterSettings({ ATLAS_IMAGE_DELIVERY: 'kind' }).Context, 'kind-kubero');
  const env = { ATLAS_IMAGE_DELIVERY: 'registry', ATLAS_KUBE_CONTEXT: 'test-k3s', ATLAS_IMAGE_REGISTRY: 'registry.test:443/atlas/', ATLAS_DOMAIN_SUFFIX: 'apps.test', ATLAS_BUILD_PLATFORM: 'linux/arm64' };
  const settings = getClusterSettings(env);
  assert.equal(settings.Platform, 'linux/arm64'); assert.equal(settings.PullPolicy, 'IfNotPresent'); assert.equal(settings.Repository, 'registry.test:443/atlas');
  for (const [key, value] of [['ATLAS_KUBE_CONTEXT', ''], ['ATLAS_DOMAIN_SUFFIX', ''], ['ATLAS_IMAGE_REGISTRY', 'https://wrong'], ['ATLAS_BUILD_PLATFORM', 'invalid'], ['ATLAS_IMAGE_DELIVERY', 'invalid']]) assert.throws(() => getClusterSettings({ ...env, [key]: value }));
});
