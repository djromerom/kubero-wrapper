import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cli, repoRoot, localDir, run, database, acquireLock, sleep, sqlLiteral as q } from './runtime.mjs';
import { validateProjectId } from './deploy-local.mjs';

export const claimSql = `WITH next_project AS (
 SELECT id FROM projects WHERE status='approved' AND registration_approved_at IS NOT NULL AND deletion_requested_at IS NULL
 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
), claimed AS (
 UPDATE projects p SET status='building', updated_at=NOW()
 FROM next_project WHERE p.id=next_project.id RETURNING p.id,p.status
) SELECT id::text || '|' || status::text FROM claimed;`;

export const deletionSql = `SELECT id::text FROM projects WHERE deletion_requested_at IS NOT NULL AND deletion_error IS NULL AND status NOT IN ('deleted','building') ORDER BY deletion_requested_at LIMIT 1;`;

export function protectLog(details, config = {}) {
  const secrets = [...Object.values(config.runtime_env || {}), ...Object.values(config.build_env || {})].map(String).flatMap(v => [v, ...v.split(/\r?\n/)]).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const secret of secrets) details = details.replaceAll(secret, '[oculto]');
  return details.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/g, '$1[oculto]$2');
}

export async function watchDeployments({ once = false, root = localDir, db = database, runner = run } = {}) {
  const release = await acquireLock('deploy-worker', root);
  if (!release) return;
  const logDir = join(root, 'deployments');
  await mkdir(logDir, { recursive: true });
  const log = message => appendFile(join(logDir, 'worker.log'), `${new Date().toISOString()} ${message}\n`);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await log('Monitor de despliegues iniciado.');
    do {
      try {
        const deletion = (await db(deletionSql)).trim();
        if (deletion) {
          const id = validateProjectId(deletion);
          const result = await runner(process.execPath, [join(repoRoot, 'scripts/delete-local.mjs'), '--project-id', id], { allowFailure: true });
          await writeFile(join(logDir, `${id}-deletion.log`), `${result.stdout}\n${result.stderr}`);
          if (result.code !== 0) {
            await db(`UPDATE projects SET deletion_error=COALESCE(deletion_error, 'No se pudo completar la eliminación. Reintenta o consulta al administrador.'), updated_at=NOW() WHERE id=${q(id)} AND status!='deleted';`);
          }
          await log(`Eliminación ${id}: código ${result.code}.`);
          if (once) break;
          continue;
        }
        const claim = (await db(claimSql)).trim();
        if (claim) {
          const [rawId] = claim.split('|');
          const id = validateProjectId(rawId);
          const file = join(logDir, `${id}.log`);
          const config = JSON.parse(await db(`SELECT deployment_config::text FROM projects WHERE id=${q(id)};`) || '{}');
          const account = JSON.parse(await db(`SELECT json_build_object('access_token',ga.access_token) FROM github_accounts ga JOIN projects p ON p.user_id=ga.user_id WHERE p.id=${q(id)};`) || '{}');
          const redact = text => protectLog(account.access_token ? String(text).replaceAll(account.access_token, '[oculto]') : String(text), config);
          await log(`Procesando proyecto ${id}.`);
          let details = '';
          let logWrites = Promise.resolve();
          const partial = { stdout: '', stderr: '' };
          try {
            await writeFile(file, '');
            const result = await runner(process.execPath, [join(repoRoot, 'scripts/deploy-local.mjs'), '--project-id', id], { allowFailure: true, onOutput(channel, chunk) {
              partial[channel] += chunk;
              const end = partial[channel].lastIndexOf('\n');
              if (end < 0) return;
              const lines = partial[channel].slice(0, end + 1);
              partial[channel] = partial[channel].slice(end + 1);
              logWrites = logWrites.then(() => appendFile(file, redact(lines)));
            } });
            await logWrites;
            details = redact(`${result.stdout}\n${result.stderr}`);
            await writeFile(file, details);
            if (result.code !== 0) throw new Error(`El proceso terminó con código ${result.code}.`);
            await db(`UPDATE builds SET logs=${q(details)} WHERE id=(SELECT id FROM builds WHERE project_id=${q(id)} AND status='running' ORDER BY created_at DESC LIMIT 1);`);
            await log(`Proyecto ${id} procesado.`);
          } catch (error) {
            await logWrites;
            details = redact(`${details}\n${error.message}`);
            await writeFile(file, details);
            await db(`UPDATE projects SET status='failed', updated_at=NOW() WHERE id=${q(id)} AND status='building'; INSERT INTO builds(project_id,status,logs,commit_sha,started_at,completed_at) SELECT ${q(id)},'failed',${q(details)},source_commit,NOW(),NOW() FROM projects WHERE id=${q(id)};`);
            await log(`Falló el proyecto ${id}. Revisa ${file}`);
          }
        }
      } catch (error) { await log(`Error del monitor: ${error.message}`); if (once) throw error; }
      if (!once && !stopping) await sleep(5000);
    } while (!once && !stopping);
  } finally { await log('Monitor de despliegues detenido.'); await release(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}

cli(import.meta.url, 'node scripts/watch-local-deployments.mjs [--once]', args => watchDeployments({ once: args.once === true }));
