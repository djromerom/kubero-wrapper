import { acquireLock } from './runtime.mjs';

export async function withClusterMutation(action) {
  const release = await acquireLock('cluster-mutation');
  if (!release) throw new Error('Hay otra construcción o limpieza en curso. Vuelve a intentarlo cuando termine.');
  try { return await action(); } finally { await release(); }
}
