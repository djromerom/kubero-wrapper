import { mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { x as extract } from 'tar';
import { cli, repoRoot, database, kube, poll, patchResource, removeInside, sqlLiteral as q } from './runtime.mjs';
import { getClusterSettings } from './cluster-settings.mjs';
import { buildImage, copyRegistrySecret } from './kubero-build.mjs';
import { createProjectServices } from './project-services.mjs';
import { withClusterMutation } from './cluster-operation.mjs';
import { readCompose } from './compose-project.mjs';
import { composeNamespace, deployCompose, verifyPage } from './deploy-compose.mjs';

export function validateProjectId(id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) throw new Error('Proporciona un --project-id UUID válido.');
  return id.toLowerCase();
}

export function approvedImageMatches(record, sha, platform) {
  return Boolean(record.approved_image && record.adaptation_report?.build_verified && record.adaptation_report.commit === sha && record.adaptation_report.platform === platform);
}

export async function deploy({ projectId, containerPort = 3000 }, { db = database, settings = getClusterSettings(), k = kube(settings.Context), builder = buildImage, composeRunner = deployCompose, fetcher = fetch } = {}) {
  projectId = validateProjectId(projectId);
  if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) throw new Error('El puerto debe estar entre 1 y 65535.');
  const recordText = await db(`SELECT json_build_object('id',p.id,'slug',p.slug,'kubero_pipeline',p.kubero_pipeline,'requested_subdomain',p.requested_subdomain,'repo_url',p.repo_url,'branch',p.branch,'deployment_config',p.deployment_config,'source_commit',p.source_commit,'adaptation_report',p.adaptation_report,'approved_image',p.approved_image,'access_token',ga.access_token) FROM projects p JOIN github_accounts ga ON ga.user_id=p.user_id WHERE p.id=${q(projectId)}::uuid AND p.status IN ('approved','building') AND p.deletion_requested_at IS NULL LIMIT 1;`);
  if (!recordText) throw new Error('El proyecto debe estar en la cola de despliegue y tener GitHub vinculado.');
  const record = JSON.parse(recordText), match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(record.repo_url);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(record.slug) || !match) throw new Error('El nombre o repositorio guardado no tiene el formato esperado.');
  if (!/^[a-f0-9]{40}$/i.test(record.source_commit || '')) throw new Error('El proyecto registrado no tiene un commit válido.');
  await k(['get', 'crd', 'kuberoapps.application.kubero.dev']);
  const [, owner, repository] = match, slug = record.slug;
  const workRoot = join(repoRoot, '.local', 'work');
  await mkdir(workRoot, { recursive: true });
  const workDir = await mkdtemp(join(workRoot, `${slug}-`));
  let report, sha;
  try {
    const headers = { Authorization: `Bearer ${record.access_token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const base = `https://api.github.com/repos/${owner}/${repository}`;
    const response = await fetcher(`${base}/commits/${record.source_commit}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`GitHub no pudo resolver el commit (${response.status}).`);
    sha = (await response.json()).sha;
    if (sha !== record.source_commit) throw new Error('GitHub no devolvió el commit del proyecto registrado.');
    const archive = await fetcher(`${base}/tarball/${sha}`, { headers, signal: AbortSignal.timeout(120_000) });
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
    const label = record.requested_subdomain || slug;
    if (!/^[a-z0-9][a-z0-9-]{1,47}[a-z0-9]$/.test(label)) throw new Error('El subdominio guardado no tiene el formato esperado.');
    const domain = label + '.' + settings.DomainSuffix;
    const compose = await readCompose(sourceDir, configuration);
    if (compose) {
      report = { version: 1, commit: sha, platform: settings.Platform, engine: 'kubernetes', build_strategy: 'Docker Compose', compose_file: compose.file,
        services: compose.services.map(s => s.name), web_service: compose.web, build_verified: false, runtime_verified: false, blockers: [] };
      const result = await composeRunner(compose, { id: projectId, slug, sha, domain, configuration, settings, k });
      Object.assign(report, result, { build_verified: true });
      if (record.kubero_pipeline === 'atlas') {
        await k(['delete', 'kuberoapp', slug, '-n', 'atlas-production', '--ignore-not-found', '--wait=true']);
        await k(['delete', 'deployment,service,job', '-l', 'atlas-project=' + slug, '-n', 'atlas-production', '--ignore-not-found']);
      }
    } else {
      const dockerfile = existsSync(join(sourceDir, 'Dockerfile')) ? 'Dockerfile' : existsSync(join(sourceDir, 'dockerfile')) ? 'dockerfile' : '';
      if (!dockerfile) throw new Error('El proyecto requiere un Dockerfile o un archivo Compose en la raíz.');
      report = { version: 1, commit: sha, platform: settings.Platform, engine: 'kubero', build_strategy: 'Kubero / dockerfile', port, build_verified: false, runtime_verified: false, blockers: [], changes: ['Kubero construye el Dockerfile del commit registrado.'] };
      configuration.port = port;
      const reusing = approvedImageMatches(record, sha, settings.Platform);
      let image = record.approved_image;
      if (!reusing) {
        const build = await builder({ settings, slug, commit: sha, repository: record.repo_url, strategy: 'dockerfile', dockerfile, configuration, gitToken }, { k });
        image = build.Image;
        Object.assign(report, { kubero_build: build.Build, kubero_job: build.Job, kubero_namespace: build.Namespace });
      }
      Object.assign(report, { build_verified: true, image, summary: 'Imagen construida desde el Dockerfile. Comprobando el despliegue.' });
      await db(`UPDATE projects SET approved_image=${q(image)}, adaptation_report=${q(JSON.stringify(report))}::jsonb, updated_at=NOW() WHERE id=${q(projectId)} AND status IN ('approved','building');`);
      console.log(`Desplegando la imagen ${image}...`);
      await k.apply({ apiVersion: 'application.kubero.dev/v1alpha1', kind: 'KuberoPipeline', metadata: { name: 'atlas', namespace: 'kubero' }, spec: {
        name: 'atlas', deploymentstrategy: 'docker', buildstrategy: 'plain', reviewapps: false, git: { provider: '', keys: { priv: 'Zm9v', pub: 'YmFy' }, repository: { admin: false, ssh_url: '', clone_url: '' } }, registry: { createSecret: 'none' }, phases: [{ name: 'production', context: 'inClusterContext', enabled: true }] } });
      await poll(async () => (await k.json(['get', 'namespace', 'atlas-production', '--ignore-not-found']))?.status.phase === 'Active', { message: 'Kubero no creó el namespace atlas-production.' });
      if (settings.Delivery === 'registry') await copyRegistrySecret(k, 'atlas-production', settings.ImagePullSecret);
      const services = createProjectServices(settings, k);
      const runtimeValues = await services.initialize(slug, configuration);
      await services.migrate(slug, image, configuration.migration_command, runtimeValues);
      await services.setWorker(slug, image, configuration.worker_command, runtimeValues);
      const split = image.lastIndexOf(':');
      await k.apply({ apiVersion: 'application.kubero.dev/v1alpha1', kind: 'KuberoApp', metadata: { name: slug, namespace: 'atlas-production' }, spec: {
        name: slug, pipeline: 'atlas', phase: 'production', deploymentstrategy: 'docker', buildstrategy: 'plain', image: { repository: image.slice(0, split), tag: image.slice(split + 1), pullPolicy: settings.PullPolicy, containerPort: port },
        service: { port: 80, type: 'ClusterIP' }, web: { replicaCount: 1 }, worker: { replicaCount: 0 }, addons: [], ingress: { enabled: true, className: settings.IngressClass, annotations: {}, hosts: [{ host: domain, paths: [{ path: '/', pathType: 'Prefix' }] }], tls: [] },
        healthcheck: { enabled: true, path: healthPath }, envVars: Object.entries(runtimeValues).map(([name, value]) => ({ name, value: String(value) })) } });
      const deployment = `deployment/${slug}-kuberoapp-web`;
      await poll(() => k(['get', deployment, '-n', 'atlas-production', '--ignore-not-found', '-o', 'name']), { interval: 5000, message: 'El operador de Kubero no creó el Deployment.' });
      if (settings.ImagePullSecret) await patchResource(k, [deployment, '-n', 'atlas-production'], { spec: { template: { spec: { imagePullSecrets: [{ name: settings.ImagePullSecret }] } } } });
      await k(['rollout', 'restart', deployment, '-n', 'atlas-production']);
      await k(['rollout', 'status', deployment, '-n', 'atlas-production', '--timeout=240s'], { live: true });
      if (record.kubero_pipeline === 'atlas-compose') {
        await k(['delete', 'ingress,deployments,services', '-n', composeNamespace(projectId), '-l', 'atlas-project=' + slug, '--ignore-not-found']);
      }
    }
    const url = `http://${domain}${healthPath}`;
    await verifyPage(url, fetcher);
    Object.assign(report, { runtime_verified: true, summary: 'La aplicación responde en su URL.' });
    await db(`UPDATE projects SET status='running', domain=${q(domain)}, approved_image=${q(report.image)}, kubero_pipeline=${q(compose ? 'atlas-compose' : 'atlas')}, kubero_app=${q(slug)}, adaptation_report=${q(JSON.stringify(report))}::jsonb, updated_at=NOW() WHERE id=${q(projectId)} AND status IN ('approved','building'); INSERT INTO builds(project_id,status,logs,commit_sha,commit_message,started_at,completed_at) SELECT ${q(projectId)},'running','Imagen verificada publicada por Ingress',${q(sha)},'Despliegue local',NOW(),NOW() FROM projects WHERE id=${q(projectId)} AND status='running' AND NOT EXISTS (SELECT 1 FROM builds WHERE project_id=${q(projectId)} AND commit_sha=${q(sha)} AND status='running');`);
    console.log(`Aplicación disponible: ${url}`);
  } catch (error) {
    if (report) {
      report.summary = error.message.replace('ATLAS_CORRECTION: ', '');
      await db(`UPDATE projects SET adaptation_report=${q(JSON.stringify(report))}::jsonb WHERE id=${q(projectId)} AND status IN ('approved','building');`);
    }
    console.log('Diagnóstico del despliegue:');
    for (const name of [`${slug}-kuberoapp-web`, `${slug}-background`, `${slug}-postgres`, `${slug}-redis`]) {
      if (await k(['get', 'deployment', name, '-n', 'atlas-production', '--ignore-not-found', '-o', 'name'], { allowFailure: true })) await k(['logs', `deployment/${name}`, '-n', 'atlas-production', '--all-containers=true', '--tail=100'], { live: true, allowFailure: true });
    }
    throw error;
  } finally { await removeInside(workRoot, workDir); }
}

cli(import.meta.url, 'node scripts/deploy-local.mjs --project-id UUID [--container-port 3000]', args => {
  if (args['adapt-only']) throw new Error('La adaptación previa está desactivada. Registra el proyecto para iniciar su construcción.');
  return withClusterMutation(() => deploy({ projectId: args['project-id'], containerPort: Number(args['container-port'] || 3000) }));
});
