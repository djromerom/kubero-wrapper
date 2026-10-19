import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, kube, removeInside, acquireLock, argumentsFor } from '../runtime.mjs';
import { validateProjectId, approvedImageMatches } from '../deploy-local.mjs';
import { protectLog, watchDeployments } from '../watch-local-deployments.mjs';
import { getClusterSettings } from '../cluster-settings.mjs';
import { createProjectServices } from '../project-services.mjs';

test('procesos reales: stdin, argumentos literales, códigos de error y contexto explícito', async () => {
  const literal = 'spaces ; $(echo injected) & "quotes"';
  const output = await run(process.execPath, ['-e', 'process.stdin.on("data",c=>process.stdout.write(c));process.stdout.write(process.argv[1])', literal], { input: 'input' });
  assert.equal(output.stdout, literal + 'input');
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(7)']), error => error.code === 7);
  const calls = [];
  await kube('explicit-context', async (...args) => { calls.push(args); return { stdout: '{}' }; }).apply({ kind: 'Secret', stringData: { value: 'private' } });
  assert.deepEqual(calls[0][1], ['--context', 'explicit-context', 'apply', '-f', '-']);
  assert.equal(JSON.parse(calls[0][2].input).stringData.value, 'private');
  assert.throws(() => kube(''));
  assert.deepEqual(argumentsFor(['--project-id', 'id', '--adapt-only']), { 'project-id': 'id', 'adapt-only': true });
});

test('bloqueo exclusivo y limpieza restringida al directorio permitido', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-lock-'));
  try {
    const release = await acquireLock('worker', root);
    assert.equal(await acquireLock('worker', root), null);
    await assert.rejects(removeInside(root, root));
    await assert.rejects(removeInside(root, join(root, '..', 'outside')));
    await release();
    const again = await acquireLock('worker', root);
    await again();
  } finally { await removeInside(tmpdir(), root); }
});

test('aprobación no reutiliza imágenes de otro SHA o plataforma y valida UUID antes de SQL', () => {
  assert.throws(() => validateProjectId("anything' OR true"));
  const record = { approved_image: 'image:tag', adaptation_report: { build_verified: true, commit: 'sha', platform: 'linux/amd64' } };
  assert.equal(approvedImageMatches(record, 'sha', 'linux/amd64'), true);
  assert.equal(approvedImageMatches(record, 'other', 'linux/amd64'), false);
  assert.equal(approvedImageMatches(record, 'sha', 'linux/arm64'), false);
});

test('monitor Node registra fallos y oculta secretos, incluso al dividirse entre chunks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-worker-'));
  const id = '12345678-1234-1234-1234-123456789abc', queries = [];
  const db = async sql => {
    queries.push(sql);
    if (sql.startsWith('WITH')) return `${id}|building`;
    if (sql.includes('deployment_config::text')) return JSON.stringify({ runtime_env: { TOKEN: 'secret-value' } });
    if (sql.includes("json_build_object('access_token'")) return JSON.stringify({ access_token: 'github-token' });
    return '';
  };
  try {
    await watchDeployments({ once: true, root, db, runner: async (command, args, options) => {
      assert.equal(command, process.execPath); assert.ok(args[0].endsWith('deploy-local.mjs'));
      options.onOutput('stdout', 'token=secret-'); options.onOutput('stdout', 'value\n');
      return { code: 1, stdout: 'ATLAS_CORRECTION: secret-value', stderr: 'github-token' };
    } });
    const logs = await readFile(join(root, 'deployments', `${id}.log`), 'utf8');
    assert.ok(!logs.includes('secret-value') && !logs.includes('github-token'));
    assert.ok(queries.some(q => q.includes("status='corrections'")));
    assert.ok(!queries.some(q => q.includes("status='running'")));
    assert.equal(protectLog('postgresql://user:password@host/db'), 'postgresql://user:[oculto]@host/db');
  } finally { await removeInside(tmpdir(), root); }
});

test('migración fallida impide continuar y mantiene el contexto y las credenciales existentes', async () => {
  const applied = [], calls = [];
  const k = async args => { calls.push(args); return ''; };
  k.apply = async resource => applied.push(resource);
  k.json = async args => args[1] === 'secret' ? { data: { POSTGRES_PASSWORD: Buffer.from('stable').toString('base64') } } : { status: { failed: 1 } };
  const services = createProjectServices(getClusterSettings({}), k, {});
  const values = await services.initialize('test', { port: 3000, postgres: true });
  assert.ok(values.DATABASE_URL.includes('stable@'));
  assert.equal(applied.find(r => r.kind === 'PersistentVolumeClaim').spec.resources.requests.storage, '1Gi');
  await assert.rejects(services.migrate('test', 'image:tag', 'exit 1', values), /no terminó/);
  assert.ok(calls.some(args => args[0] === 'delete' && args[1] === 'job'));
  await services.setWorker('test', 'image:tag', '', values);
  assert.ok(calls.some(args => args[0] === 'delete' && args[1] === 'deployment'));
});
