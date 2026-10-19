import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { repoRoot, run } from './runtime.mjs';

export function getClusterSettings(env = process.env) {
  const Delivery = env.ATLAS_IMAGE_DELIVERY || 'k3d';
  if (!['kind', 'k3d', 'registry'].includes(Delivery)) throw new Error('ATLAS_IMAGE_DELIVERY debe ser k3d, kind o registry.');
  const Platform = env.ATLAS_BUILD_PLATFORM || 'linux/amd64';
  if (!['linux/amd64', 'linux/arm64'].includes(Platform)) throw new Error('Selecciona linux/amd64 o linux/arm64 para este ejecutor.');
  const registry = env.ATLAS_IMAGE_REGISTRY;
  if (Delivery === 'registry' && (!registry || /\s|:\/\/|[;&|]/.test(registry))) throw new Error('Configura ATLAS_IMAGE_REGISTRY con host/ruta, sin protocolo.');
  const Context = env.ATLAS_KUBE_CONTEXT || (Delivery === 'kind' ? 'kind-kubero' : Delivery === 'k3d' ? 'k3d-atlas' : '');
  if (!Context) throw new Error('Configura ATLAS_KUBE_CONTEXT antes de desplegar en un clúster remoto.');
  const DomainSuffix = env.ATLAS_DOMAIN_SUFFIX || (Delivery !== 'registry' ? 'app.127.0.0.1.sslip.io' : '');
  if (!DomainSuffix || !/^[a-zA-Z0-9.-]+$/.test(DomainSuffix)) throw new Error('Configura ATLAS_DOMAIN_SUFFIX con el dominio de las aplicaciones.');
  return { Delivery, Platform, Context, Repository: Delivery === 'registry' ? registry.replace(/\/+$/, '') : 'atlas', PullPolicy: Delivery === 'registry' ? 'IfNotPresent' : 'Never', DomainSuffix,
    IngressClass: env.ATLAS_INGRESS_CLASS || (Delivery === 'kind' ? 'nginx' : 'traefik'), ImagePullSecret: env.ATLAS_IMAGE_PULL_SECRET || (Delivery === 'registry' ? 'kubero-pull-secret' : ''),
    StorageClass: env.ATLAS_STORAGE_CLASS || (Delivery === 'k3d' ? 'local-path' : undefined), StorageSize: env.ATLAS_POSTGRES_STORAGE || '1Gi' };
}

export const k3dCommand = () => {
  const bundled = join(repoRoot, '.local', 'tools', process.platform === 'win32' ? 'k3d.exe' : 'k3d');
  return existsSync(bundled) ? bundled : 'k3d';
};

export async function publishImage(image, settings, runner = run) {
  if (settings.Delivery === 'registry') await runner('docker', ['push', image], { live: true });
  else if (settings.Delivery === 'k3d') await runner(k3dCommand(), ['image', 'import', image, '--cluster', 'atlas'], { live: true });
  else {
    const bundled = join(dirname(repoRoot), 'kubero', 'tools', process.platform === 'win32' ? 'kind.exe' : 'kind');
    await runner(existsSync(bundled) ? bundled : 'kind', ['load', 'docker-image', image, '--name', 'kubero'], { live: true });
  }
}
