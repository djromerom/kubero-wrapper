import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { cli, repoRoot, kube, run, patchResource } from './runtime.mjs';
import { getClusterSettings, publishImage } from './cluster-settings.mjs';
import { copyRegistrySecret } from './kubero-build.mjs';

export async function installBuilder(context, settings = getClusterSettings()) {
  if (settings.Context !== context) throw new Error('El contexto debe coincidir con ATLAS_KUBE_CONTEXT.');
  const k = kube(context);
  const revision = createHash('sha256').update(await readFile(join(repoRoot, 'infra/kubero-operator/patch-build-chart.py'))).digest('hex').slice(0, 12);
  const image = `${settings.Repository}/kubero-operator:atlas-v2-${settings.Platform.split('/')[1]}-${revision}`;
  await run('docker', ['build', '--provenance=false', '--platform', settings.Platform, '-t', image, join(repoRoot, 'infra/kubero-operator')], { live: true });
  await publishImage(image, settings);
  const deployment = await k.json(['get', 'deployment', 'kubero-operator-controller-manager', '-n', 'kubero-operator-system']);
  const patch = { spec: { template: { metadata: { annotations: { 'atlas.dev/build-contract': '2' } }, spec: { containers: [{ name: deployment.spec.template.spec.containers[0].name, image, imagePullPolicy: settings.PullPolicy }] } } } };
  if (settings.Delivery === 'registry') {
    await copyRegistrySecret(k, 'kubero-operator-system');
    patch.spec.template.spec.imagePullSecrets = [{ name: 'kubero-pull-secret' }];
  }
  await patchResource(k, ['deployment', 'kubero-operator-controller-manager', '-n', 'kubero-operator-system'], patch, 'strategic');
  await k(['rollout', 'status', 'deployment/kubero-operator-controller-manager', '-n', 'kubero-operator-system', '--timeout=180s'], { live: true });
}

cli(import.meta.url, 'node scripts/install-kubero-builder.mjs --context CONTEXTO', args => installBuilder(args.context));
