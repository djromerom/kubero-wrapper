const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const originalLoader = require.extensions['.ts'];
const originalFetch = global.fetch;
const originalStorage = global.localStorage;

require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(result.outputText, filename);
};

const { api } = require('../src/api.ts');

after(() => {
  require.extensions['.ts'] = originalLoader;
  global.fetch = originalFetch;
  global.localStorage = originalStorage;
});

function backend(response, status = 200) {
  const calls = [];
  global.localStorage = { getItem: key => key === 'token' ? 'test-token' : null };
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: status < 400, status, json: async () => response };
  };
  return calls;
}

test('project lists and details use the authenticated backend', async () => {
  const projects = [{ id: 'project-1', name: 'Proyecto', status: 'pending' }];
  const calls = backend(projects);
  assert.deepEqual(await api.listProjects(), projects);
  await api.adminListProjects();
  await api.getProject('project-1');
  assert.deepEqual(calls.map(call => call.url), [
    '/api/projects', '/api/admin/projects', '/api/projects/project-1',
  ]);
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, 'Bearer test-token');
    assert.equal(call.options.cache, 'no-store');
  }
});

test('creation, corrections and review send their real API payloads', async () => {
  const calls = backend({ id: 'project-1' });
  const project = {
    name: 'Proyecto', repo_url: 'https://github.com/owner/project', branch: 'main',
    requested_subdomain: 'project', purpose: 'Aplicación académica', course: 'Diseño Web II',
  };
  await api.createProject(project);
  await api.resubmitProject('project-1', 'Propósito corregido');
  await api.reviewProject('project-1', 'corrections', 'Revisar construcción', true);
  assert.deepEqual(calls.map(call => [call.url, call.options.method]), [
    ['/api/projects', 'POST'],
    ['/api/projects/project-1/resubmit', 'POST'],
    ['/api/admin/projects/project-1/review', 'POST'],
  ]);
  assert.deepEqual(JSON.parse(calls[0].options.body), project);
  assert.deepEqual(JSON.parse(calls[1].options.body), { purpose: 'Propósito corregido' });
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    decision: 'corrections', note: 'Revisar construcción', technical_correction: true,
  });
});

test('GitHub and subdomain choices are fetched from the backend', async () => {
  const calls = backend({ available: true });
  await api.githubStatus();
  await api.listGithubRepositories();
  await api.listGithubBranches('owner', 'project');
  assert.deepEqual(await api.subdomainAvailability('project'), { available: true });
  assert.deepEqual(calls.map(call => call.url), [
    '/api/github/status', '/api/github/repositories',
    '/api/github/repositories/owner/project/branches',
    '/api/subdomains/availability?name=project',
  ]);
});

test('backend failures surface to the caller and empty responses are accepted', async () => {
  backend({ error: 'Se requiere autenticación' }, 401);
  await assert.rejects(api.listProjects(), /Se requiere autenticación/);
  const calls = backend(undefined, 204);
  assert.equal(await api.githubDisconnect(), undefined);
  assert.equal(calls[0].options.method, 'DELETE');
});
