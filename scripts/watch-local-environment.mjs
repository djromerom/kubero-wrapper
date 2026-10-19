import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cli, repoRoot, localDir, run, acquireLock, alive, sleep } from './runtime.mjs';

export async function watchEnvironment({ once = false } = {}) {
  const release = await acquireLock('environment');
  if (!release) return;
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    do {
      try {
        const result = await run('docker', ['inspect', 'kubero-wrapper-backend-1'], { allowFailure: true });
        const backend = result.code === 0 ? JSON.parse(result.stdout)[0] : null;
        if (backend?.State.Running) {
          let worker;
          try { worker = JSON.parse(await readFile(join(localDir, 'deploy-worker.lock/owner.json'), 'utf8')); } catch {}
          if (!backend.Config.Env.includes('LOCAL_IMAGE_DEPLOYMENT=true') || !alive(worker?.pid)) {
            const child = await run(process.execPath, [join(repoRoot, 'scripts/start-local-kubero.mjs')], { allowFailure: true });
            await appendFile(join(localDir, 'environment.out.log'), child.stdout + '\n');
            await appendFile(join(localDir, 'environment.err.log'), child.stderr + '\n');
            if (child.code !== 0) throw new Error(`El arranque terminó con código ${child.code}.`);
          }
        }
      } catch (error) { await appendFile(join(localDir, 'environment.log'), `${error.message}\n`); if (once) throw error; }
      if (!once && !stopping) await sleep(15_000);
    } while (!once && !stopping);
  } finally { await release(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}

cli(import.meta.url, 'node scripts/watch-local-environment.mjs [--once]', args => watchEnvironment({ once: args.once === true }));
