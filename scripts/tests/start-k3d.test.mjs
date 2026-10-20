import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startK3d } from '../start-k3d.mjs';

const restarting = () => Object.assign(new Error('k3d terminó con código 1'), {
  stderr: "error during post-start cluster preparation: node k3d-atlas-server-0 is running=true in status=restarting",
});
const running = { Running: true, Restarting: false, Dead: false, OOMKilled: false };

test('un arranque correcto no provoca reintentos ni esperas adicionales', async () => {
  let starts = 0;
  await startK3d({
    runner: async () => { starts++; return { code: 0 }; },
    waitFor: async () => assert.fail('No debe esperar tras un arranque correcto'),
  });
  assert.equal(starts, 1);
});

test('espera al nodo y al API antes de repetir la preparación de k3d', async () => {
  let starts = 0, inspections = 0, probes = 0;
  await startK3d({
    warn: () => {},
    runner: async (command, args, options) => {
      if (args[0] === 'cluster') {
        starts++;
        if (starts === 1) throw restarting();
        return { code: 0 };
      }
      assert.equal(command, 'docker');
      if (args[0] === 'inspect') {
        inspections++;
        return { stdout: JSON.stringify({ ...running, Restarting: inspections === 1 }) };
      }
      assert.deepEqual(args, ['exec', 'k3d-atlas-server-0', 'k3s', 'kubectl', 'get', '--raw=/readyz', '--request-timeout=3s']);
      assert.equal(options.allowFailure, true);
      probes++;
      return probes === 1 ? { code: 1, stdout: '' } : { code: 0, stdout: 'ok' };
    },
    waitFor: async (check, options) => {
      assert.equal(options.timeout, 120_000);
      assert.equal(await check(), false);
      assert.equal(probes, 0);
      assert.equal(await check(), false);
      assert.equal(await check(), true);
      assert.equal(starts, 1);
    },
  });
  assert.equal(starts, 2);
});

test('otros fallos de k3d se propagan sin intentar recuperaciones', async () => {
  const failure = new Error('Docker no está disponible');
  await assert.rejects(startK3d({
    runner: async () => { throw failure; },
    waitFor: async () => assert.fail('No debe ocultar errores ajenos al reinicio'),
  }), error => error === failure);
});

test('un reinicio persistente termina con diagnóstico y no se reintenta indefinidamente', async () => {
  let starts = 0;
  await assert.rejects(startK3d({
    warn: () => {},
    runner: async () => { starts++; throw restarting(); },
    waitFor: async () => {},
  }), /k3d terminó/);
  assert.equal(starts, 2);

  starts = 0;
  await assert.rejects(startK3d({
    warn: () => {},
    runner: async () => { starts++; throw restarting(); },
    waitFor: async (_, options) => { throw new Error(options.message); },
  }), /K3s no se recuperó/);
  assert.equal(starts, 1);
});
