const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, filename) => {
 const result = ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
 module._compile(result.outputText,filename);
};
const storage = new Map();
global.sessionStorage = { getItem:key=>storage.get(key)??null, setItem:(key,value)=>storage.set(key,value), removeItem:key=>storage.delete(key) };
const { startDemo, endDemo, isDemoGithubLinked, linkDemoGithub } = require('../src/demoSession.ts');
const { listDemoProjects, submitDemoProject, reviewDemoProject, updateDemoProject } = require('../src/demoProjects.ts');
test('Demo: GitHub starts unlinked and is linked explicitly', () => {
 storage.clear();startDemo('developer');
 assert.equal(isDemoGithubLinked(),false);
 linkDemoGithub();assert.equal(isDemoGithubLinked(),true);
 endDemo();startDemo('developer');assert.equal(isDemoGithubLinked(),false);
});
test('Demo: fixtures, owner isolation, admission and cross-role persistence', () => {
 storage.clear(); startDemo('developer');
 assert.equal(listDemoProjects().length,6);
 assert.equal(listDemoProjects(true).length,6);
 const project=listDemoProjects().find(p=>p.id==='portafolio');
 assert.throws(()=>reviewDemoProject(project.id,'approve',project.submission.repo),/administrador/);
 assert.throws(()=>updateDemoProject('dulce',{status:'running'},'Invalid'),/acceso/);
 const draft={...project.submission,name:'nuevo-proyecto',repo:'sarikr/nuevo-proyecto'};
 submitDemoProject(draft); assert.equal(listDemoProjects().length,7);
 assert.throws(()=>submitDemoProject(draft),/Ya registraste/);
 endDemo();startDemo('admin');
 assert.equal(listDemoProjects(true).length,14);
 assert.throws(()=>reviewDemoProject('portafolio','approve','wrong'),/exactamente/);
 reviewDemoProject('portafolio','approve',project.submission.repo);
 assert.equal(listDemoProjects(true).find(p=>p.id==='portafolio').status,'ci_pending');
 assert.throws(()=>reviewDemoProject('portafolio','approve',project.submission.repo),/pendiente/);
 const created=listDemoProjects(true).find(p=>p.slug==='nuevo-proyecto');
 assert.throws(()=>reviewDemoProject(created.id,'corrections','   '),/Explica/);
 reviewDemoProject(created.id,'corrections','Explica el contexto académico.');
 endDemo();startDemo('developer');
 assert.equal(listDemoProjects().find(p=>p.id==='portafolio').status,'ci_pending');
 assert.equal(listDemoProjects().find(p=>p.id===created.id).observation,'Explica el contexto académico.');
 assert.equal(listDemoProjects().find(p=>p.id===created.id).history.length,2);
});
test('Existing per-role demo submissions are retained on migration', () => {
 storage.clear();startDemo('developer');
 const original=listDemoProjects()[0];storage.delete('atlas.demo.projects.shared.v2');
 storage.set('atlas.demo.projects.demo-developer', JSON.stringify([{...original,id:'legacy',name:'Legacy'}]));
 assert.ok(listDemoProjects().some(p=>p.id==='legacy'&&p.ownerId==='demo-developer'));
});
