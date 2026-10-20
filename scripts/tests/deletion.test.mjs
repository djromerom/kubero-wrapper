import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteProject } from '../delete-local.mjs';
import { removeLocalImages } from '../image-cleanup.mjs';
import { watchDeployments, deletionSql } from '../watch-local-deployments.mjs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeInside } from '../runtime.mjs';

const id = '12345678-1234-1234-1234-123456789abc';

function projectFixture({ imageError = false, resourceError = false } = {}) {
  const calls = [];
  const db = async sql => {
    calls.push(sql);
    if (sql.startsWith('SELECT')) return JSON.stringify({ slug: 'fixture', kubero_app: 'fixture', kubero_pipeline: 'atlas' });
    return id;
  };
  const k = async args => { calls.push(args); if (resourceError && args[0] === 'delete') throw new Error('Clúster no disponible'); return ''; };
  k.json = async () => ({ items: [] });
  const removeImages = async () => { calls.push('images'); if (imageError) throw new Error('Registro no disponible'); };
  return { calls, deps: { db, k, removeImages } };
}

test('solo marca eliminado después de verificar recursos e imágenes', async () => {
  const { calls, deps } = projectFixture();
  await deleteProject(id, deps);
  assert.ok(calls.findIndex(call => Array.isArray(call) && call[0] === 'delete') < calls.indexOf('images'));
  assert.ok(calls.indexOf('images') < calls.findIndex(call => typeof call === 'string' && call.includes("status='deleted'")));
});

test('un fallo de Kubero o del registro mantiene visible el proyecto y guarda el error para reintentar', async () => {
  for (const options of [{ imageError: true }, { resourceError: true }]) {
    const { calls, deps } = projectFixture(options);
    await assert.rejects(deleteProject(id, deps), /no disponible/);
    assert.ok(!calls.some(call => typeof call === 'string' && call.includes("SET status='deleted'")));
    assert.ok(calls.some(call => typeof call === 'string' && call.includes('SET deletion_error=')));
  }
});

function imageFixture({ referenced = false, deleteFails = false, cacheFails = false, gcFails = false } = {}) {
  let removed = false, cached = true;
  const calls = [];
  const image = { id: 'sha256:cache', repoTags: ['10.43.0.1:5000/fixture:v1'] };
  const k = async (args, options) => {
    calls.push(args);
    if (args[0] !== 'exec' || !args.includes('node')) return '';
    const { method } = JSON.parse(options.input);
    if (method === 'GET') return JSON.stringify({ status: 200, body: JSON.stringify({ tags: removed ? [] : ['v1'] }) });
    if (method === 'HEAD') return JSON.stringify({ status: removed ? 404 : 200, digest: `sha256:${'a'.repeat(64)}` });
    if (deleteFails) return JSON.stringify({ status: 500 });
    removed = true;
    return JSON.stringify({ status: 202 });
  };
  k.json = async args => {
    if (args[1] === 'service') return { spec: { clusterIP: '10.43.0.1' } };
    if (args[1] === 'deployment') return { spec: { selector: { matchLabels: { run: 'registry' } }, template: { spec: { containers: [{ name: 'registry', env: [{ name: 'REGISTRY_STORAGE_DELETE_ENABLED', value: 'true' }] }] } } } };
    if (args[1] === 'pods' && args.includes('-l')) return { items: [{ metadata: { name: 'registry-ready' }, status: { containerStatuses: [{ name: 'registry', ready: true }] } }] };
    if (args[1] === 'nodes') return { items: [{ metadata: { name: 'k3d-atlas-server-0' } }] };
    if (args[1] === 'job') return { status: gcFails ? { failed: 1 } : { succeeded: 1 } };
    return { items: referenced ? [{ metadata: { name: 'in-use', namespace: 'other' }, spec: { containers: [{ image: image.repoTags[0] }] } }] : [] };
  };
  k.apply = async resource => { calls.push(['apply-gc', resource.kind]); };
  const runner = async (_command, args) => {
    calls.push(args);
    if (args.includes('rmi')) { if (cacheFails) throw new Error('Caché ocupada'); cached = false; }
    return { stdout: JSON.stringify({ images: cached ? [image] : [] }) };
  };
  return { calls, deps: { k, runner } };
}

test('protege imágenes referenciadas y no toca el registro ni la caché', async () => {
  const { calls, deps } = imageFixture({ referenced: true });
  await assert.rejects(removeLocalImages('fixture', deps), /sigue referenciada/);
  assert.equal(calls.length, 0);
});

test('verifica manifiestos y caché, y ejecuta GC con el registro detenido', async () => {
  const { calls, deps } = imageFixture();
  assert.deepEqual(await removeLocalImages('fixture', deps), { repository: 'fixture', manifests: 1, cachedImages: 1 });
  assert.ok(calls.some(args => args.includes('rmi')));
  assert.ok(calls.some(args => args[0] === 'apply-gc'));
  assert.ok(calls.some(args => args[0] === 'scale' && args.includes('--replicas=0')));
  assert.ok(calls.some(args => args[0] === 'scale' && args.includes('--replicas=1')));
});

test('fallos de borrado, caché o GC se propagan y permiten reintentar', async () => {
  for (const options of [{ deleteFails: true }, { cacheFails: true }, { gcFails: true }]) {
    const { calls, deps } = imageFixture(options);
    await assert.rejects(removeLocalImages('fixture', deps));
    if (options.gcFails) assert.ok(calls.some(args => args[0] === 'scale' && args.includes('--replicas=1')), 'restaura el registro incluso si falla GC');
  }
});

test('el ejecutor atiende la eliminación antes de construir y conserva un fallo visible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-deletion-worker-'));
  const queries = [];
  try {
    await watchDeployments({ once: true, root,
      db: async sql => { queries.push(sql); return sql === deletionSql ? id : ''; },
      runner: async (_command, args) => {
        assert.ok(args[0].endsWith('delete-local.mjs'));
        return { code: 1, stdout: '', stderr: 'No se pudo contactar al registro' };
      },
    });
    assert.ok(!queries.some(sql => sql.startsWith('WITH next_project')));
    assert.ok(queries.some(sql => sql.includes('deletion_error=COALESCE')));
    assert.match(await readFile(join(root, 'deployments', `${id}-deletion.log`), 'utf8'), /registro/);
  } finally { await removeInside(tmpdir(), root); }
});
