import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, basename, extname } from 'node:path';

export async function getAdaptationReport(sourceDir, configuration = {}, commit, platform) {
  const files = [], components = [], blockers = [], warnings = [], services = new Set();
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !['node_modules', '.git', 'dist', 'generated', '.next'].includes(entry.name)) await walk(join(dir, entry.name));
      else if (entry.isFile()) files.push(join(dir, entry.name));
    }
  }
  await walk(sourceDir);
  for (const file of files.filter(f => basename(f) === 'package.json')) {
    const path = relative(sourceDir, file).split('\\').join('/');
    let pkg;
    try { pkg = JSON.parse(await readFile(file, 'utf8')); } catch { blockers.push(`El manifiesto ${path} no es JSON válido.`); continue; }
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const framework = deps.includes('next') ? 'next' : deps.includes('astro') ? 'astro' : deps.includes('vite') ? 'vite' : deps.includes('@nestjs/core') ? 'nestjs' : 'node';
    if (pkg.scripts?.build || pkg.scripts?.start || pkg.scripts?.['start:prod']) components.push({ path, framework });
    if (deps.some(d => ['@prisma/client', 'pg', 'typeorm'].includes(d))) services.add('database');
    if (deps.some(d => /bull|redis/.test(d))) services.add('redis');
    if (deps.includes('dockerode')) blockers.push(`El componente ${path} requiere ejecutar contenedores: falta integrar un runner compatible con Kubernetes.`);
    if (deps.some(d => ['@astrojs/vercel', '@astrojs/cloudflare'].includes(d))) blockers.push(`El componente ${path} utiliza un adaptador específico de otro proveedor; configura un adaptador para el servidor de Atlas.`);
  }
  if (components.length > 1) blockers.push('Se detectaron varios componentes. Esta primera versión requiere un plan explícito por componente antes de construir.');
  const runtime = configuration.runtime_env || {}, build = configuration.build_env || {};
  if (services.has('database') && !configuration.postgres && !runtime.DATABASE_URL && !runtime.DB_HOST) blockers.push('Configura la base de datos requerida por la aplicación.');
  if (services.has('redis') && !configuration.redis && !runtime.REDIS_URL && !runtime.REDIS_HOST) blockers.push('Configura Redis para las colas de trabajo.');
  for (const file of files) {
    const name = basename(file), size = (await stat(file)).size;
    if (size < 524288 && (/^(Dockerfile|.*compose.*\.ya?ml|wrangler\..*)$/i.test(name) || ['.ts', '.js', '.mjs', '.sh'].includes(extname(file)))) {
      const text = await readFile(file, 'utf8');
      if (/\/var\/run\/docker.sock|spawn\([\s\r\n]*['"]docker['"]|docker run|docker build/.test(text)) blockers.push('La aplicación requiere Docker desde su proceso de ejecución; se necesita un runner aislado compatible con Atlas.');
      if (name.startsWith('wrangler.')) blockers.push('Se detectó un Worker de Cloudflare: requiere mantener el servicio externo o adaptar su ejecución.');
      if (/^Dockerfile$/i.test(name) && /CMD.*(start:dev|run.*dev)/.test(text)) blockers.push('El Dockerfile inicia un servidor de desarrollo. Proporciona una configuración de producción.');
    }
    if (/^\.env.*example$/.test(name) && size < 65536) {
      for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
        const key = /^\s*([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
        if (!key || ['PORT', 'HOST', 'NODE_ENV'].includes(key) || (configuration.postgres && key === 'DATABASE_URL') || (configuration.redis && ['REDIS_HOST', 'REDIS_PORT', 'REDIS_URL'].includes(key))) continue;
        if (!runtime[key] && !build[key]) warnings.push(`Revisar la variable ${key} indicada en el archivo de ejemplo.`);
      }
    }
  }
  if (services.has('database') && !configuration.migration_command) warnings.push('No se configuró un comando de migración. Verifica cómo se inicializa el esquema.');
  return { version: 1, commit, platform, components, services: [...services], blockers: [...new Set(blockers)], warnings: [...new Set(warnings)], image: null, build_verified: false, runtime_verified: false,
    outcome: blockers.length ? 'intervention_required' : files.some(f => relative(sourceDir, f).toLowerCase() === 'dockerfile') ? 'compatible' : 'adapted',
    summary: 'Inspección de compatibilidad completada. La construcción y la ejecución se verifican por separado.' };
}
