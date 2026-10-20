import { cli, database, kube, poll, sqlLiteral as q } from './runtime.mjs';
import { validateProjectId } from './deploy-local.mjs';
import { removeLocalImages } from './image-cleanup.mjs';
import { withClusterMutation } from './cluster-operation.mjs';
import { getClusterSettings } from './cluster-settings.mjs';

const managedResources = ['deployments', 'replicasets', 'pods', 'services', 'ingresses', 'jobs', 'cronjobs', 'secrets', 'configmaps', 'persistentvolumeclaims', 'serviceaccounts', 'roles', 'rolebindings', 'horizontalpodautoscalers'];

export async function deleteProject(projectId, { db = database, k = kube('k3d-atlas'), removeImages = removeLocalImages } = {}) {
  const id = validateProjectId(projectId);
  const record = await db(`SELECT json_build_object('slug',slug,'kubero_app',kubero_app,'kubero_pipeline',kubero_pipeline,'approved_image',approved_image) FROM projects WHERE id=${q(id)} AND deletion_requested_at IS NOT NULL AND status NOT IN ('building','deleted');`);
  if (!record) throw new Error('El proyecto no tiene una eliminación pendiente o está construyéndose.');
  const project = JSON.parse(record);
  const slug = project.slug, app = project.kubero_app || slug;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug) || app !== slug || (project.kubero_pipeline && project.kubero_pipeline !== 'atlas')) throw new Error('La aplicación no corresponde al despliegue local esperado.');
  try {
    console.log(`Retirando recursos de ${slug}...`);
    const selectors = [`app.kubernetes.io/instance=${app}`, `atlas-project=${slug}`];
    const claimIds = new Set();
    for (const labels of selectors) {
      const claims = await k.json(['get', 'persistentvolumeclaims', '-n', 'atlas-production', '-l', labels]);
      for (const claim of claims.items) claimIds.add(claim.metadata.uid);
    }
    await k(['delete', 'kuberoapp', app, '-n', 'atlas-production', '--ignore-not-found', '--wait=true', '--timeout=180s']);
    // Helm removes its own resources; Atlas owns the optional database, Redis,
    // migration and worker resources, all selected by this exact project label.
    for (const labels of selectors) {
      await k(['delete', managedResources.join(','), '-n', 'atlas-production', '-l', labels, '--ignore-not-found', '--wait=true', '--timeout=180s']);
    }
    await poll(async () => {
      const cr = await k(['get', 'kuberoapp', app, '-n', 'atlas-production', '--ignore-not-found', '-o', 'name']);
      if (cr) return false;
      for (const labels of selectors) {
        const remaining = await k.json(['get', managedResources.join(','), '-n', 'atlas-production', '-l', labels]);
        if (remaining.items.length) return false;
      }
      if (claimIds.size) {
        const volumes = await k.json(['get', 'persistentvolumes']);
        if (volumes.items.some(volume => claimIds.has(volume.spec.claimRef?.uid))) return false;
      }
      return true;
    }, { timeout: 60000, message: 'Kubero todavía tiene recursos del proyecto.' });
    console.log('Recursos retirados. Eliminando las imágenes del registro y de K3s...');
    await removeImages(slug, { k });
    const result = await db(`UPDATE projects SET status='deleted', domain=NULL, approved_image=NULL, deletion_error=NULL, updated_at=NOW() WHERE id=${q(id)} AND deletion_requested_at IS NOT NULL AND status NOT IN ('building','deleted') RETURNING id;`);
    if (!result) throw new Error('La limpieza terminó, pero Atlas no pudo confirmar la eliminación.');
    console.log('Eliminación verificada: recursos e imágenes retirados.');
  } catch (error) {
    await db(`UPDATE projects SET deletion_error=${q(error.message)}, updated_at=NOW() WHERE id=${q(id)} AND status!='deleted';`);
    throw error;
  }
}

cli(import.meta.url, 'node scripts/delete-local.mjs --project-id UUID | --image-repository REPOSITORIO', args => {
  const settings = getClusterSettings();
  if (settings.Delivery !== 'k3d' || settings.Context !== 'k3d-atlas') throw new Error('Esta limpieza está disponible para el laboratorio K3s local.');
  return withClusterMutation(async () => {
  if (Boolean(args['project-id']) === Boolean(args['image-repository'])) throw new Error('Indica un proyecto o un repositorio de imagen.');
  if (args['project-id']) return deleteProject(args['project-id']);
  const result = await removeLocalImages(args['image-repository']);
  console.log(JSON.stringify(result));
  });
});
