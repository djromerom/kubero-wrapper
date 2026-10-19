import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli, kube, run, removeInside } from '../runtime.mjs';
import { getClusterSettings, publishImage } from '../cluster-settings.mjs';
import { createProjectServices } from '../project-services.mjs';

cli(import.meta.url, 'node scripts/tests/project-services.integration.mjs [--context CONTEXTO]', async args => {
  const settings = getClusterSettings();
  if (args.context && args.context !== settings.Context) throw new Error('El contexto debe coincidir con ATLAS_KUBE_CONTEXT.');
  const k = kube(settings.Context), services = createProjectServices(settings, k, {});
  const namespace = `atlas-test-${randomUUID().slice(0, 8)}`;
  let imageDir;
  let created = false;
  try {
    await k(['create', 'namespace', namespace]); created = true;
    const config = { port: 3000, postgres: true, redis: true, runtime_env: { TEST_VALUE: 'Atlas' } };
    const values = await services.initialize('sample', config, namespace);
    assert.ok(values.DATABASE_URL.includes('@sample-postgres:5432/app')); assert.equal(values.REDIS_HOST, 'sample-redis');
    await k(['exec', '-n', namespace, 'deployment/sample-postgres', '--', 'psql', '-U', 'atlas', '-d', 'app', '-c', "CREATE TABLE atlas_test(value text); INSERT INTO atlas_test VALUES ('persisted');"]);
    const again = await services.initialize('sample', config, namespace);
    assert.equal(again.DATABASE_URL, values.DATABASE_URL);
    assert.equal(await k(['exec', '-n', namespace, 'deployment/sample-postgres', '--', 'psql', '-U', 'atlas', '-d', 'app', '-t', '-A', '-c', 'SELECT value FROM atlas_test;']), 'persisted');
    assert.equal(await k(['exec', '-n', namespace, 'deployment/sample-redis', '--', 'redis-cli', 'ping']), 'PONG');
    let image = 'node:22-bookworm-slim';
    if (settings.Delivery !== 'registry') {
      image = `atlas/service-test:${namespace}`;
      imageDir = await mkdtemp(join(tmpdir(), 'atlas-service-image-'));
      await writeFile(join(imageDir, 'Dockerfile'), 'FROM node:22-bookworm-slim\n');
      await run('docker', ['build', '--provenance=false', '--platform', settings.Platform, '-t', image, imageDir], { live: true });
      await publishImage(image, settings);
    }
    await services.migrate('sample', image, 'node -e "if(process.env.TEST_VALUE!==\'Atlas\'||!process.env.DATABASE_URL)process.exit(1);console.log(\'migration-ok\')"', values, namespace);
    await assert.rejects(services.migrate('sample', image, 'node -e "process.exit(1)"', values, namespace));
    await services.setWorker('sample', image, 'node -e "console.log(\'worker-ok\');setInterval(()=>{},1000)"', values, namespace);
    await services.setWorker('sample', image, '', values, namespace);
    config.redis = false;
    await services.initialize('sample', config, namespace);
    assert.equal(await k(['get', 'deployment', 'sample-redis', '-n', namespace, '-o', 'jsonpath={.spec.replicas}']), '0');
    console.log('OK: PostgreSQL persistente, Redis, migración exitosa/fallida, worker y desactivación.');
  } finally {
    try { if (created && /^atlas-test-[a-f0-9]{8}$/.test(namespace)) await k(['delete', 'namespace', namespace, '--wait=false']); }
    finally { if (imageDir) await removeInside(tmpdir(), imageDir); }
  }
});
