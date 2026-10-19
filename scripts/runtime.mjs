import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm, rename, open } from 'node:fs/promises';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const localDir = join(repoRoot, '.local');
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args.map(String), { cwd: repoRoot, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], ...options });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; options.onOutput?.('stdout', chunk.toString()); if (options.live) process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { stderr += chunk; options.onOutput?.('stderr', chunk.toString()); if (options.live) process.stderr.write(chunk); });
    child.on('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', code => {
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code !== 0 && !options.allowFailure) {
        reject(Object.assign(new Error(`${command} terminó con código ${code}: ${result.stderr}`), result));
      } else resolve(result);
    });
    child.stdin.end(options.input ?? '');
  });
}

export function kube(context, runner = run) {
  if (!context) throw new Error('Selecciona explícitamente el contexto de Kubernetes.');
  const localConfig = join(localDir, 'k3s.kubeconfig');
  const configArgs = context === 'k3d-atlas' && !process.env.KUBECONFIG && existsSync(localConfig) ? ['--kubeconfig', localConfig] : [];
  const call = async (args, options) => (await runner('kubectl', ['--context', context, ...configArgs, ...args], options)).stdout;
  call.json = async args => { const text = await call([...args, '-o', 'json']); return text ? JSON.parse(text) : null; };
  call.apply = resource => call(['apply', '-f', '-'], { input: JSON.stringify(resource) });
  return call;
}

export async function patchResource(k, args, patch, type = 'merge') {
  // A real file also works with Windows kubectl, where /dev/stdin is unavailable.
  const directory = join(localDir, `patch-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'patch.json');
  try {
    await writeFile(file, JSON.stringify(patch));
    return await k(['patch', ...args, `--type=${type}`, '--patch-file', file]);
  } finally { await removeInside(localDir, directory); }
}

export async function removeInside(root, target) {
  const rel = relative(resolve(root), resolve(target));
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) throw new Error('Destino de limpieza fuera del directorio permitido.');
  await rm(target, { recursive: true, force: true });
}

export async function poll(check, { timeout = 120_000, interval = 2000, message = 'La operación superó el tiempo disponible.' } = {}) {
  const deadline = Date.now() + timeout;
  do { const value = await check(); if (value) return value; await sleep(interval); } while (Date.now() < deadline);
  throw new Error(message);
}

export function argumentsFor(argv = process.argv.slice(2)) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(argv[i]);
    if (!match) throw new Error(`Argumento no válido: ${argv[i]}`);
    result[match[1]] = match[2] ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return result;
}

export function cli(meta, usage, action) {
  if (!process.argv[1] || meta !== pathToFileURL(resolve(process.argv[1])).href) return;
  Promise.resolve().then(() => {
    const args = argumentsFor();
    if (args.help) console.log(usage);
    else return action(args);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}

export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export async function acquireLock(name, root = localDir) {
  await mkdir(root, { recursive: true });
  const directory = join(root, `${name}.lock`);
  const owner = { pid: process.pid, token: randomUUID() };
  try { await mkdir(directory); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let previous;
    try { previous = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8')); } catch { return null; }
    if (alive(previous.pid)) return null;
    const stale = `${directory}-${randomUUID()}`;
    try { await rename(directory, stale); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    await removeInside(root, stale);
    return acquireLock(name, root);
  }
  await writeFile(join(directory, 'owner.json'), JSON.stringify(owner));
  return async () => {
    const current = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8'));
    if (current.token === owner.token) await removeInside(root, directory);
  };
}

export async function startBackground(script, args, name, options = {}) {
  await mkdir(localDir, { recursive: true });
  const out = await open(join(localDir, `${name}.out.log`), 'a');
  const err = await open(join(localDir, `${name}.err.log`), 'a');
  try {
    const child = spawn(process.execPath, [script, ...args], { cwd: repoRoot, detached: true, windowsHide: true, ...options, stdio: ['ignore', out.fd, err.fd] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    return child.pid;
  } finally { await out.close(); await err.close(); }
}

export const sqlLiteral = value => `'${String(value).replaceAll("'", "''")}'`;
export async function database(sql, runner = run) {
  return (await runner('docker', ['compose', '-f', join(repoRoot, 'compose.yaml'), 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'kubero_wrapper', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: sql })).stdout;
}
