import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../runtime.mjs';

test('retired deployment entry points exit before invoking infrastructure', async () => {
  for (const entry of ['watch-local-deployments.mjs', 'start-local-kubero.mjs', 'setup-k3s.mjs', 'delete-local.mjs']) {
    const result = await run(process.execPath, [`scripts/${entry}`], { allowFailure: true });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /laboratorio local está retirado/);
  }
});
