const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const os = require('node:os');

test('cliente API → proxy Vite → backend Rust → PostgreSQL reales', { timeout: 60_000 }, async () => {
  const backend = process.env.ATLAS_TEST_BACKEND_URL;
  const email = process.env.ATLAS_TEST_CLIENT_EMAIL;
  assert.ok(backend && email, 'Ejecutar mediante la suite de integración Rust, que prepara y limpia los datos.');
  const originalFetch = global.fetch;
  const originalStorage = global.localStorage;
  const originalLoader = require.extensions['.ts'];
  const originalProxy = process.env.VITE_API_PROXY_TARGET;
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-api-integration-'));
  let vite;
  try {
    process.env.VITE_API_PROXY_TARGET = backend;
    const { createServer } = await import('vite');
    vite = await createServer({ cacheDir, server: { host: '127.0.0.1', port: 0, strictPort: true, open: false }, logLevel: 'error' });
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const storage = new Map();
    // Node no tiene el origen de un navegador ni localStorage. Se adaptan esos
    // dos elementos; todas las solicitudes usan fetch real y sockets HTTP.
    global.localStorage = { getItem: key => storage.get(key) ?? null };
    global.fetch = (url, options) => originalFetch(new URL(url, origin), options);
    require.extensions['.ts'] = (module, filename) => {
      const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      });
      module._compile(result.outputText, filename);
    };
    const { api } = require('../src/api.ts');
    assert.equal((await api.health()).status, 'ok');
    await assert.rejects(api.listProjects(), /Missing or invalid Authorization header/);
    const password = randomUUID();
    const registered = await api.register({ name: 'Client integration', email, password });
    assert.ok(registered.user.id && registered.token);
    assert.equal(registered.user.email, email);
    await assert.rejects(api.register({ name: 'Duplicate', email, password }), /Email already registered/);
    await assert.rejects(api.login({ email, password: 'wrong-password' }), /Unauthorized/);
    const login = await api.login({ email, password });
    assert.equal(login.user.id, registered.user.id);
    storage.set('token', login.token);
    assert.deepEqual(await api.listProjects(), []);
    assert.equal((await api.githubStatus()).linked, false);
    assert.equal(await api.githubDisconnect(), undefined);
    storage.set('token', 'invalid-token');
    await assert.rejects(api.listProjects(), /Invalid or expired token/);
  } finally {
    global.fetch = originalFetch;
    global.localStorage = originalStorage;
    require.extensions['.ts'] = originalLoader;
    if (originalProxy === undefined) delete process.env.VITE_API_PROXY_TARGET;
    else process.env.VITE_API_PROXY_TARGET = originalProxy;
    await vite?.close();
    assert.ok(path.resolve(cacheDir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
