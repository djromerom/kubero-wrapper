import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';

export const composeFiles = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
const fail = reason => { throw new Error('Compose: ' + reason); };
const mapping = v => v && typeof v === 'object' && !Array.isArray(v);

function keys(value, allowed, where) {
  if (!mapping(value)) fail(where + ' debe ser un mapa.');
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(where + ': opción no admitida: ' + key);
  }
}

async function inside(root, path) {
  if (typeof path !== 'string' || !path || /[:\\\x00]/.test(path) || path.startsWith('/')) fail('se requiere una ruta relativa al repositorio.');
  const target = await realpath(resolve(root, path));
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith('..' + sep) || resolve(root, rel) !== target || /^[a-z]:/i.test(rel)) fail('ruta fuera del repositorio.');
  return target;
}

function variables(values = {}, project = {}) {
  const pairs = Array.isArray(values) ? values.map(line => {
    const idx = String(line).indexOf('=');
    return idx < 0 ? [line, null] : [line.slice(0, idx), line.slice(idx + 1)];
  }) : Object.entries(values);
  return Object.fromEntries(pairs.map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || (value != null && typeof value === 'object')) fail('variable no válida.');
    if (value == null && !Object.hasOwn(project, key)) fail('configura la variable ' + key + ' en Atlas.');
    return [key, String(value ?? project[key])];
  }));
}

function portNumber(entry) {
  if (mapping(entry)) keys(entry, ['target', 'published', 'host_ip', 'protocol', 'mode'], 'ports');
  const value = mapping(entry) ? (entry.protocol && entry.protocol !== 'tcp' ? '' : entry.target) : String(entry).split(':').pop().replace(/\/tcp$/, '');
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) fail('se requiere un puerto TCP individual.');
  return Number(value);
}

function commandArgs(value, key) {
  if (value == null) return undefined;
  if (Array.isArray(value) && value.every(arg => typeof arg === 'string')) return value;
  if (typeof value === 'string' && /^[\w./:=@+\s-]+$/.test(value)) return value.trim().split(/\s+/);
  fail('usa una lista de argumentos en ' + key + ' para conservar las comillas.');
}

function probe(check) {
  if (!check) return undefined;
  keys(check, ['test', 'interval', 'timeout', 'start_period', 'retries', 'disable'], 'healthcheck');
  if (check.disable || check.test?.[0] === 'NONE') return undefined;
  const test = typeof check.test === 'string' ? ['CMD-SHELL', check.test] : check.test;
  if (!Array.isArray(test) || !test.slice(1).every(v => typeof v === 'string') || test.length < 2 || !['CMD', 'CMD-SHELL'].includes(test[0])) fail('healthcheck.test no válido.');
  const result = { exec: { command: test[0] === 'CMD' ? test.slice(1) : ['/bin/sh', '-c', test[1]] } };
  for (const [field, key] of [['interval', 'periodSeconds'], ['timeout', 'timeoutSeconds'], ['start_period', 'initialDelaySeconds']]) {
    if (check[field] == null) continue;
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(check[field]);
    if (!match) fail('duración inválida en healthcheck.' + field);
    result[key] = Math.max(1, Math.ceil(Number(match[1]) * ({ ms: 0.001, s: 1, m: 60, h: 3600 })[match[2]]));
  }
  if (check.retries != null) {
    if (!Number.isInteger(check.retries) || check.retries < 1) fail('healthcheck.retries no válido.');
    result.failureThreshold = check.retries;
  }
  return result;
}

async function mountFiles(root, path) {
  const target = await inside(root, path);
  const entries = [];
  let bytes = 0;
  async function visit(file) {
    const stat = await lstat(file);
    if (stat.isDirectory()) {
      for (const child of await readdir(file)) await visit(join(file, child));
    } else {
      if (!stat.isFile() || entries.length >= 512 || (bytes += stat.size) > 700_000) fail('el montaje debe contener archivos del repositorio de hasta 700 KB en total.');
      entries.push({ path: relative(target, file).split(sep).join('/') || basename(file), data: (await readFile(file)).toString('base64') });
    }
  }
  await visit(target);
  return { entries, single: (await lstat(target)).isFile() };
}

export async function readCompose(root, configuration = {}) {
  root = await realpath(root);
  const filenames = await readdir(root);
  const file = composeFiles.find(name => filenames.includes(name));
  if (!file) return null;
  const source = await inside(root, file);
  if ((await lstat(source)).size > 256_000) fail('archivo demasiado grande.');
  const projectEnv = { ...configuration.build_env, ...configuration.runtime_env };
  // Interpolate scalar values only, using project variables, never the worker environment.
  function interpolate(value) {
    if (Array.isArray(value)) return value.map(interpolate);
    if (mapping(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v)]));
    if (typeof value !== 'string') return value;
    return value.replace(/\$\$|\$\{([A-Za-z_]\w*)(?:(:-|-)([^}]*))?\}|\$([A-Za-z_]\w*)/g, (match, braced, op, fallback, plain) => {
      if (match === '$$') return '$';
      const key = braced || plain;
      if (Object.hasOwn(projectEnv, key) && (op !== ':-' || projectEnv[key] !== '')) return projectEnv[key];
      if (op) return fallback;
      fail('configura la variable ' + key + ' en Atlas.');
    });
  }
  const doc = interpolate(parse(await readFile(source, 'utf8'), { merge: true, prettyErrors: false }));
  keys(doc, ['version', 'name', 'services', 'volumes', 'x-atlas-web'], file);
  if (!mapping(doc.services) || !Object.keys(doc.services).length) fail('faltan servicios.');
  const volumes = Object.keys(doc.volumes || {});
  for (const v of volumes) {
    if (!/^[a-z][a-z0-9-]{0,50}$/.test(v)) fail('nombre de volumen no válido.');
    keys(doc.volumes[v] ?? {}, [], 'volumen ' + v);
  }
  const services = [];
  for (const [name, spec] of Object.entries(doc.services)) {
    if (!/^[a-z][a-z0-9-]{0,60}[a-z0-9]$|^[a-z]$/.test(name)) fail('nombre de servicio no válido: ' + name);
    keys(spec, ['image', 'build', 'ports', 'expose', 'environment', 'volumes', 'depends_on', 'command', 'entrypoint', 'restart', 'working_dir', 'container_name', 'healthcheck'], name);
    if (!spec.image && !spec.build) fail(name + ' requiere image o build.');
    if (spec.image && (typeof spec.image !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]*$/.test(spec.image))) fail('referencia image no válida.');
    let build;
    if (spec.build) {
      const b = typeof spec.build === 'string' ? { context: spec.build } : spec.build;
      keys(b, ['context', 'dockerfile', 'args', 'target'], name + '.build');
      const context = await inside(root, b.context ?? '.');
      const dockerfile = await inside(context, b.dockerfile ?? 'Dockerfile');
      if (!(await lstat(context)).isDirectory() || !(await lstat(dockerfile)).isFile()) fail('context o dockerfile no válido.');
      build = { context, dockerfile, args: { ...configuration.build_env, ...variables(b.args, projectEnv) }, target: b.target };
    }
    const mounts = [];
    for (const mount of spec.volumes ?? []) {
      if (typeof mount !== 'string') fail('usa la sintaxis origen:destino para los volúmenes.');
      const [from, to, mode, ...extra] = mount.split(':');
      if (!to?.startsWith('/') || extra.length || (mode && !['ro', 'rw'].includes(mode))) fail('montaje no admitido.');
      if (volumes.includes(from)) mounts.push({ volume: from, to, readOnly: mode === 'ro' });
      else if (from.startsWith('./') && mode !== 'rw') mounts.push({ ...await mountFiles(root, from), to, readOnly: true });
      else fail('usa un volumen declarado o un archivo relativo al repositorio de solo lectura.');
    }
    let depends = spec.depends_on ?? [];
    if (mapping(depends)) {
      for (const [dep, opts] of Object.entries(depends)) {
        keys(opts, ['condition'], 'depends_on.' + dep);
        if (!['service_started', 'service_healthy'].includes(opts.condition)) fail('condición de dependencia no admitida.');
        if (opts.condition === 'service_healthy' && !probe(doc.services[dep]?.healthcheck)) fail(dep + ' necesita un healthcheck explícito.');
      }
      depends = Object.keys(depends);
    }
    if (!Array.isArray(depends) || !depends.every(s => typeof s === 'string' && Object.hasOwn(doc.services, s))) fail('depends_on debe ser una lista de servicios del proyecto.');
    services.push({ name, image: spec.image, build, mounts, depends, environment: variables(spec.environment, projectEnv),
      published: (spec.ports ?? []).map(portNumber), exposed: (spec.expose ?? []).map(portNumber),
      command: commandArgs(spec.entrypoint, 'entrypoint'), args: commandArgs(spec.command, 'command'),
      readinessProbe: probe(spec.healthcheck), workingDir: spec.working_dir });
  }
  const published = services.filter(s => s.published.length);
  const web = doc['x-atlas-web'] ?? (published.length === 1 ? published[0].name : services.find(s => s.name === 'web')?.name ?? (services.length === 1 ? services[0].name : null));
  if (!services.some(s => s.name === web)) fail('selecciona el servicio HTTP con x-atlas-web.');
  const ordered = [];
  while (ordered.length < services.length) {
    const next = services.find(s => !ordered.includes(s) && s.depends.every(name => ordered.some(dep => dep.name === name)));
    if (!next) fail('depends_on contiene un ciclo.');
    ordered.push(next);
  }
  return { file, web, services: ordered, volumes };
}
