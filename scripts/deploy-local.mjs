import { mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { x as extract } from 'tar';
import { cli, repoRoot, database, kube, poll, patchResource, removeInside, sqlLiteral as q } from './runtime.mjs';
import { getClusterSettings } from './cluster-settings.mjs';
import { getAdaptationReport } from './adaptation.mjs';
import { getBuildEnvironment, buildImage, copyRegistrySecret } from './kubero-build.mjs';
import { createProjectServices } from './project-services.mjs';

export function validateProjectId(id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) throw new Error('Proporciona un --project-id UUID válido.');
  return id.toLowerCase();
}

export function approvedImageMatches(record, sha, platform) {
  return Boolean(record.approved_image && record.adaptation_report?.build_verified && record.adaptation_report.commit === sha && record.adaptation_report.platform === platform);
}

export async function deploy({ projectId, containerPort = 3000, adaptOnly = false }, { db = database, settings = getClusterSettings(), k = kube(settings.Context) } = {}) {
  projectId = validateProjectId(projectId);
  if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) throw new Error('El puerto debe estar entre 1 y 65535.');
  if (!adaptOnly) await k(['get', 'crd', 'kuberoapps.application.kubero.dev']);
  const recordText = await db(`SELECT json_build_object('id',p.id,'slug',p.slug,'requested_subdomain',p.requested_subdomain,'repo_url',p.repo_url,'branch',p.branch,'deployment_config',p.deployment_config,'source_commit',p.source_commit,'adaptation_report',p.adaptation_report,'approved_image',p.approved_image,'access_token',ga.access_token) FROM projects p JOIN github_accounts ga ON ga.user_id=p.user_id WHERE p.id=${q(projectId)}::uuid AND p.status IN ('approved','building','running','failed','adapting') LIMIT 1;`);
  if (!recordText) throw new Error('No se encontró el proyecto o su GitHub no está vinculado.');
  const record = JSON.parse(recordText), match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(record.repo_url);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(record.slug) || !match) throw new Error('El nombre o repositorio guardado no tiene el formato esperado.');
  const [, owner, repository] = match, slug = record.slug;
  const workRoot = join(repoRoot, '.local', 'work');
  await mkdir(workRoot, { recursive: true });
  const workDir = await mkdtemp(join(workRoot, `${slug}-`));
  let report, sha;
  try {
    const headers = { Authorization: `Bearer ${record.access_token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const base = `https://api.github.com/repos/${owner}/${repository}`;
    const response = await fetch(`${base}/commits/${encodeURIComponent(record.source_commit || record.branch)}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`GitHub no pudo resolver el commit (${response.status}).`);
    sha = (await response.json()).sha;
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('GitHub no devolvió un commit válido.');
    const archive = await fetch(`${base}/tarball/${sha}`, { headers, signal: AbortSignal.timeout(120_000) });
    if (!archive.ok) throw new Error(`GitHub no pudo entregar el código (${archive.status}).`);
    const archivePath = join(workDir, 'source.tar.gz'), sourceDir = join(workDir, 'source');
    await pipeline(Readable.fromWeb(archive.body), createWriteStream(archivePath));
    await mkdir(sourceDir);
    await extract({ file: archivePath, cwd: sourceDir, strip: 1, strict: true, preservePaths: false });
    if (!(await readdir(sourceDir)).length) throw new Error('El archivo de GitHub no contiene código fuente.');
    const gitToken = record.access_token;
    delete record.access_token;
    const configuration = record.deployment_config || {};
    const port = configuration.port || containerPort, healthPath = configuration.health_path || '/';
    report = await getAdaptationReport(sourceDir, configuration, sha, settings.Platform);
    if (report.blockers.length) throw new Error(`ATLAS_CORRECTION: ${report.blockers.join(' ')}`);
    const dockerfile = existsSync(join(sourceDir, 'Dockerfile')) ? 'Dockerfile' : existsSync(join(sourceDir, 'dockerfile')) ? 'dockerfile' : '';
    const strategy = dockerfile ? 'dockerfile' : process.env.ATLAS_KUBERO_BUILD_STRATEGY || 'buildpacks';
    Object.assign(report, { engine: 'kubero', build_strategy: `Kubero / ${strategy}`, port, changes: [dockerfile ? 'Kubero construye el Dockerfile proporcionado por el desarrollador.' : `Kubero detecta y empaqueta la aplicación con ${strategy}; Atlas no genera Dockerfiles.`] });
    if (strategy === 'buildpacks') {
      configuration.build_env = await getBuildEnvironment(sourceDir, configuration);
      const options = Object.keys(configuration.build_env).filter(k => k.startsWith('BP_'));
      if (options.length) report.changes.push(`Opciones de buildpack transmitidas a Kubero: ${options.join(', ')}.`);
    }
    configuration.port = port;
    const reusing = !adaptOnly && approvedImageMatches(record, sha, settings.Platform);
    if (!adaptOnly && !reusing) throw new Error('ATLAS_CORRECTION: La imagen aprobada no corresponde al commit o a la arquitectura del ejecutor. Vuelve a adaptar y aprobar el proyecto.');
    let image = record.approved_image;
    if (!reusing) {
      const build = await buildImage({ settings, slug, commit: sha, repository: record.repo_url, strategy, dockerfile, configuration, gitToken }, { k });
      image = build.Image;
      Object.assign(report, { kubero_build: build.Build, kubero_job: build.Job, kubero_namespace: build.Namespace });
    }
    if (adaptOnly) {
      Object.assign(report, { build_verified: true, image, summary: 'Kubero empaquetó el commit y publicó su imagen. La ejecución, las conexiones y las migraciones se verifican durante el despliegue aprobado.' });
      await db(`UPDATE projects SET status='pending', source_commit=${q(sha)}, adaptation_report=${q(JSON.stringify(report))}::jsonb, approved_image=${q(image)}, updated_at=NOW() WHERE id=${q(projectId)} AND status='adapting';`);
      console.log('Adaptación completada. Proyecto pendiente de revisión administrativa.');
      return;
    }
    console.log(`Desplegando la imagen aprobada ${image}...`);
    await k.apply({ apiVersion: 'application.kubero.dev/v1alpha1', kind: 'KuberoPipeline', metadata: { name: 'atlas', namespace: 'kubero' }, spec: {
      name: 'atlas', deploymentstrategy: 'docker', buildstrategy: 'plain', reviewapps: false, git: { provider: '', keys: { priv: 'Zm9v', pub: 'YmFy' }, repository: { admin: false, ssh_url: '', clone_url: '' } }, registry: { createSecret: 'none' }, phases: [{ name: 'production', context: 'inClusterContext', enabled: true }] } });
    await poll(async () => (await k.json(['get', 'namespace', 'atlas-production', '--ignore-not-found']))?.status.phase === 'Active', { message: 'Kubero no creó el namespace atlas-production.' });
    if (settings.Delivery === 'registry') await copyRegistrySecret(k, 'atlas-production', settings.ImagePullSecret);
    const services = createProjectServices(settings, k, { ...process.env, ATLAS_RUNTIME_BUILDPACKS: record.adaptation_report.build_strategy?.endsWith('buildpacks') ? 'true' : 'false' });
    const runtimeValues = await services.initialize(slug, configuration);
    await services.migrate(slug, image, configuration.migration_command, runtimeValues);
    await services.setWorker(slug, image, configuration.worker_command, runtimeValues);
    const label = record.requested_subdomain || slug;
    if (!/^[a-z0-9][a-z0-9-]{1,47}[a-z0-9]$/.test(label)) throw new Error('El subdominio guardado no tiene el formato esperado.');
    const domain = `${label}.${settings.DomainSuffix}`, split = image.lastIndexOf(':');
    await k.apply({ apiVersion: 'application.kubero.dev/v1alpha1', kind: 'KuberoApp', metadata: { name: slug, namespace: 'atlas-production' }, spec: {
      name: slug, pipeline: 'atlas', phase: 'production', deploymentstrategy: 'docker', buildstrategy: 'plain', image: { repository: image.slice(0, split), tag: image.slice(split + 1), pullPolicy: settings.PullPolicy, containerPort: port },
      service: { port: 80, type: 'ClusterIP' }, web: { replicaCount: 1 }, worker: { replicaCount: 0 }, ingress: { enabled: true, className: settings.IngressClass, annotations: {}, hosts: [{ host: domain, paths: [{ path: '/', pathType: 'Prefix' }] }], tls: [] },
      healthcheck: { enabled: true, path: healthPath }, envVars: Object.entries(runtimeValues).map(([name, value]) => ({ name, value: String(value) })) } });
    const deployment = `deployment/${slug}-kuberoapp-web`;
    await poll(() => k(['get', deployment, '-n', 'atlas-production', '--ignore-not-found', '-o', 'name']), { interval: 5000, message: 'El operador de Kubero no creó el Deployment.' });
    if (settings.ImagePullSecret) await patchResource(k, [deployment, '-n', 'atlas-production'], { spec: { template: { spec: { imagePullSecrets: [{ name: settings.ImagePullSecret }] } } } });
    await k(['rollout', 'restart', deployment, '-n', 'atlas-production']);
    await k(['rollout', 'status', deployment, '-n', 'atlas-production', '--timeout=240s'], { live: true });
    const url = `http://${domain}${healthPath}`;
    await poll(async () => { try { const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) }); await response.body?.cancel(); return response.status >= 200 && response.status < 400; } catch { return false; } }, { interval: 3000, message: `La aplicación aún no responde en ${url}. Revisa el Ingress de Kubero.` });
    await db(`UPDATE projects SET status='running', domain=${q(domain)}, kubero_pipeline='atlas', kubero_app=${q(slug)}, updated_at=NOW() WHERE id=${q(projectId)}; INSERT INTO builds(project_id,status,logs,commit_sha,commit_message,started_at,completed_at) SELECT ${q(projectId)},'running','Imagen verificada publicada por Ingress',${q(sha)},'Despliegue local',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM builds WHERE project_id=${q(projectId)} AND commit_sha=${q(sha)} AND status='running');`);
    console.log(`Aplicación disponible: ${url}`);
  } catch (error) {
    if (adaptOnly) {
      report ||= { version: 1, commit: sha, components: [], blockers: [], warnings: [], build_verified: false, runtime_verified: false };
      Object.assign(report, { outcome: error.message.includes('ATLAS_CORRECTION:') ? 'intervention_required' : 'infrastructure_error', summary: error.message.replace('ATLAS_CORRECTION: ', '') });
      if (!report.blockers.length) report.blockers = ['No se completó la adaptación. Consulta los logs; los fallos de infraestructura permiten reintentar.'];
      await db(`UPDATE projects SET status='pending', approved_image=NULL, adaptation_report=${q(JSON.stringify(report))}::jsonb, updated_at=NOW() WHERE id=${q(projectId)} AND status='adapting';`);
    } else {
      console.log('Diagnóstico del despliegue:');
      for (const name of [`${slug}-kuberoapp-web`, `${slug}-background`, `${slug}-postgres`, `${slug}-redis`]) {
        if (await k(['get', 'deployment', name, '-n', 'atlas-production', '--ignore-not-found', '-o', 'name'], { allowFailure: true })) await k(['logs', `deployment/${name}`, '-n', 'atlas-production', '--all-containers=true', '--tail=100'], { live: true, allowFailure: true });
      }
    }
    throw error;
  } finally { await removeInside(workRoot, workDir); }
}

cli(import.meta.url, 'node scripts/deploy-local.mjs --project-id UUID [--container-port 3000] [--adapt-only]', args => deploy({ projectId: args['project-id'], containerPort: Number(args['container-port'] || 3000), adaptOnly: args['adapt-only'] === true }));
