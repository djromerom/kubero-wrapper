import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cli, run, sqlLiteral as q } from '../runtime.mjs';
import { claimSql } from '../watch-local-deployments.mjs';

cli(import.meta.url, 'node scripts/tests/admission.integration.mjs --database atlas_test_NOMBRE', async args => {
  if (!/^atlas_test_[a-z0-9_]+$/.test(args.database || '')) throw new Error('Usa una base aislada cuyo nombre comience con atlas_test_.');
  const db = async sql => (await run('docker', ['compose', '-f', 'compose.yaml', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', args.database, '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: sql })).stdout;
  const owner = randomUUID();
  const projects = ['pending', 'corrections', 'adapting', 'approved', 'approved'].map(status => ({ id: randomUUID(), status }));
  try {
    await db(`INSERT INTO users(id,email,password_hash,name) VALUES (${q(owner)},${q(`queue-${owner}@example.invalid`)},'unused','Queue integration');`);
    for (const [index, project] of projects.entries()) {
      await db(`INSERT INTO projects(id,user_id,name,slug,repo_url,status,source_commit,registration_approved_at) VALUES (${q(project.id)},${q(owner)},'Queue test',${q(`queue-${project.id}`)},'https://github.com/example/fixture',${q(project.status)},${q('a'.repeat(40))},${index === 4 ? 'NOW()' : 'NULL'});`);
    }
    assert.equal((await db(claimSql)).split('|')[0], projects[4].id);
    assert.equal(await db(claimSql), '');
    for (const project of projects.slice(0, 4)) {
      assert.equal(await db(`SELECT status FROM projects WHERE id=${q(project.id)};`), project.status);
    }
    assert.equal(await db(`SELECT status FROM projects WHERE id=${q(projects[4].id)};`), 'building');
    console.log('OK: el ejecutor solo reclama proyectos admitidos y aprobados; no procesa solicitudes pendientes ni correcciones.');
  } finally {
    await db(`DELETE FROM users WHERE id=${q(owner)};`);
  }
});
