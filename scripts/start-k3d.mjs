import { poll, run } from './runtime.mjs';
import { k3dCommand } from './cluster-settings.mjs';

const server = 'k3d-atlas-server-0';

export async function startK3d({ runner = run, waitFor = poll, warn = console.warn } = {}) {
  const start = () => runner(k3dCommand(), ['cluster', 'start', 'atlas'], { live: true });
  try {
    await start();
    return;
  } catch (error) {
    const output = [error.message, error.stdout, error.stderr].filter(Boolean).join('\n');
    if (!/node ['"]?k3d-atlas-server-0['"]? is running=true in status=restarting/.test(output)) throw error;
  }

  warn('El nodo K3s se reinició durante el arranque. Esperando su recuperación antes de reintentar…');
  await waitFor(async () => {
    const inspection = await runner('docker', ['inspect', server, '--format', '{{json .State}}']);
    const state = JSON.parse(inspection.stdout);
    if (!state.Running || state.Restarting || state.Dead || state.OOMKilled) return false;
    const ready = await runner('docker', ['exec', server, 'k3s', 'kubectl', 'get', '--raw=/readyz', '--request-timeout=3s'], { allowFailure: true });
    return ready.code === 0 && ready.stdout.trim() === 'ok';
  }, {
    timeout: 120_000,
    interval: 2000,
    message: 'K3s no se recuperó del reinicio. Revisa docker logs --tail 100 k3d-atlas-server-0.',
  });
  // Retry once so k3d also completes CoreDNS and load balancer preparation.
  await start();
}
