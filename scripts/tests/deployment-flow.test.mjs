import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c as archive } from 'tar';
import { deploy } from '../deploy-local.mjs';
import { getClusterSettings } from '../cluster-settings.mjs';
import { removeInside } from '../runtime.mjs';

const id = '12345678-1234-1234-1234-123456789abc';
const commit = 'a'.repeat(40);

async function fixture(t, { dockerfile = true, approvedImage = null, previousCommit = commit } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-deployment-'));
  t.after(() => removeInside(tmpdir(), directory));
  await mkdir(join(directory, 'app'));
  await writeFile(join(directory, 'app', dockerfile ? 'Dockerfile' : 'package.json'), dockerfile ? 'FROM node:22-alpine\n' : '{}');
  await archive({ cwd: directory, file: join(directory, 'source.tgz'), gzip: true }, ['app']);
  const bytes = await readFile(join(directory, 'source.tgz'));
  const calls = { builds: [], resources: [], sql: [], urls: [] };
  const record = { slug: 'fixture', repo_url: 'https://github.com/owner/project', source_commit: commit, branch: 'main', deployment_config: { port: 8080 }, access_token: 'private-token', approved_image: approvedImage,
    adaptation_report: approvedImage ? { commit: previousCommit, platform: 'linux/amd64', build_verified: true } : null };
  const db = async sql => {
    calls.sql.push(sql);
    return sql.startsWith('SELECT json_build_object') ? JSON.stringify(record) : '';
  };
  const k = async args => args[0] === 'get' && args[1].startsWith('deployment/') ? 'deployment/fixture' : '';
  k.json = async () => ({ status: { phase: 'Active' } });
  k.apply = async resource => calls.resources.push(resource);
  const fetcher = async url => {
    calls.urls.push(url);
    if (url.includes('/commits/')) return Response.json({ sha: commit });
    if (url.includes('/tarball/')) return new Response(bytes);
    return new Response('ready');
  };
  const builder = async options => {
    calls.builds.push(options);
    return { Image: 'registry/fixture:new', Build: 'fixture-build', Job: 'fixture-job', Namespace: 'fixture-builds' };
  };
  return { calls, dependencies: { db, k, fetcher, builder, settings: getClusterSettings({}) } };
}

test('una solicitud sin aprobación no descarga código ni inicia una construcción', async () => {
  let touched = false;
  const unavailable = () => { touched = true; throw new Error('No debe ejecutarse'); };
  await assert.rejects(deploy({ projectId: id }, { db: async () => '', k: unavailable, builder: unavailable, fetcher: unavailable }), /aprobado/);
  assert.equal(touched, false);
});

test('después de aprobar se construye el Dockerfile del SHA presentado y se despliega esa imagen', async t => {
  const { calls, dependencies } = await fixture(t);
  await deploy({ projectId: id }, dependencies);
  assert.equal(calls.builds.length, 1);
  assert.equal(calls.builds[0].strategy, 'dockerfile');
  assert.equal(calls.builds[0].commit, commit);
  assert.equal(calls.builds[0].configuration.port, 8080);
  assert.ok(calls.urls[0].endsWith(`/commits/${commit}`));
  const app = calls.resources.find(resource => resource.kind === 'KuberoApp');
  assert.deepEqual(app.spec.image, { repository: 'registry/fixture', tag: 'new', pullPolicy: 'Never', containerPort: 8080 });
  assert.deepEqual(app.spec.addons, [], 'Kubero necesita una lista de complementos para abrir el detalle de la aplicación');
  assert.ok(calls.sql.some(sql => sql.includes("status='running'") && sql.includes('runtime_verified')));
});

test('sin Dockerfile se informa el fallo y no se activa ningún empaquetador automático', async t => {
  const { calls, dependencies } = await fixture(t, { dockerfile: false });
  await assert.rejects(deploy({ projectId: id }, dependencies), /requiere un Dockerfile/);
  assert.equal(calls.builds.length, 0);
  assert.equal(calls.resources.length, 0);
});

test('el reintento reutiliza su imagen solo cuando coincide el commit y la plataforma', async t => {
  const current = await fixture(t, { approvedImage: 'registry/fixture:existing' });
  await deploy({ projectId: id }, current.dependencies);
  assert.equal(current.calls.builds.length, 0);
  assert.equal(current.calls.resources.find(resource => resource.kind === 'KuberoApp').spec.image.tag, 'existing');
  const stale = await fixture(t, { approvedImage: 'registry/fixture:stale', previousCommit: 'b'.repeat(40) });
  await deploy({ projectId: id }, stale.dependencies);
  assert.equal(stale.calls.builds.length, 1);
});
