import { cli, kube } from './runtime.mjs';

export async function checkCluster(context, k = kube(context)) {
  const nodes = await k.json(['get', 'nodes']);
  const storage = await k.json(['get', 'storageclasses']);
  const ingress = await k.json(['get', 'ingressclasses']);
  const installed = Boolean(await k(['get', 'crd', 'kuberoapps.application.kubero.dev', '--ignore-not-found', '-o', 'name']));
  const buildInstalled = Boolean(await k(['get', 'crd', 'kuberobuilds.application.kubero.dev', '--ignore-not-found', '-o', 'name']));
  const operator = await k.json(['get', 'deployment', 'kubero-operator-controller-manager', '-n', 'kubero-operator-system', '--ignore-not-found']);
  return { Context: context, KuberoInstalled: installed, KuberoBuildInstalled: buildInstalled, KuberoBuilderReady: operator?.spec.template.metadata.annotations?.['atlas.dev/build-contract'] === '2',
    Nodes: nodes.items.map(n => ({ Name: n.metadata.name, Architecture: n.status.nodeInfo.architecture, Kubernetes: n.status.nodeInfo.kubeletVersion, AllocatableCpu: n.status.allocatable.cpu, AllocatableMemory: n.status.allocatable.memory, Ready: n.status.conditions.some(c => c.type === 'Ready' && c.status === 'True') })),
    StorageClasses: storage.items.map(c => c.metadata.name), IngressClasses: ingress.items.map(c => c.metadata.name), Note: 'Este inventario no mide rendimiento, capacidad de las aplicaciones ni recuperación de datos.' };
}

cli(import.meta.url, 'node scripts/check-cluster.mjs --context CONTEXTO', async args => console.log(JSON.stringify(await checkCluster(args.context), null, 2)));
