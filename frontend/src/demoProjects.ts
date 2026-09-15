import { seedProjects } from './demoFixtures';
import type { Project, Build } from './api';
import { getDemoUser } from './demoSession';
export const repositories = ['sarikr/recomendador-libros', 'sarikr/lab-reservas-api', 'sarikr/portafolio-web', 'sarikr/finanzas-tracker', 'sarikr/nuevo-proyecto'];
export const commits = [
  { sha: '8f21a4cb109e7bc43c9a7d1e815bb3d9416a0b14', label: 'Último · Ajusta configuración de producción' },
  { sha: 'e17b590f7c1a242fb6731da98c545a139a210b2d', label: 'Corrige pruebas del servicio' },
  { sha: '731da20818ac4fd62e02f79bfb2304fc96a46c1a', label: 'Versión inicial funcional' },
];
export function branchesFor(repo: string) { return !repo ? [] : repo.includes('portafolio') ? ['main', 'redesign'] : repo.includes('reservas') ? ['main', 'develop', 'staging'] : ['main', 'develop']; }
export interface ProjectDraft { name: string; repo: string; branch: string; commit: string; purpose: string; academic: boolean; course: string; type: string; port: number; build: string }
export type DemoProject = Project & { submission: ProjectDraft; owner: string; ownerId: string; builds?: Build[]; observation?: string; retentionUntil?: string; deletion?: { reason: string; deadline: string; days: number; retention: number }; history?: { action: string; date: string; actor: string }[] };
const KEY = 'atlas.demo.projects.shared.v2';
function allProjects(): DemoProject[] {
 const stored = sessionStorage.getItem(KEY);
 if (stored) { try { const parsed = JSON.parse(stored); if (Array.isArray(parsed)) return parsed; } catch { /* Restore fixtures if storage was corrupted. */ } }
 const seeds=seedProjects();
 for (const role of ['developer','admin']) {
  try { const old=JSON.parse(sessionStorage.getItem(`atlas.demo.projects.demo-${role}`)||'[]') as DemoProject[]; for(const p of old) if(!seeds.some(item=>item.id===p.id)) seeds.unshift({...p,ownerId:`demo-${role}`}); } catch { /* Ignore malformed legacy data. */ }
 }
 sessionStorage.setItem(KEY,JSON.stringify(seeds)); return seeds;
}
export function listDemoProjects(all = false): DemoProject[] {
 const user=getDemoUser(); if(!user)return [];
 return allProjects().filter(p=>all && user.role==='admin' || p.ownerId===user.id);
}
export function updateDemoProject(id: string, patch: Partial<DemoProject>, action: string) {
 const user=getDemoUser(); const items=allProjects(); const project=items.find(p=>p.id===id);
 if(!user || !project || (user.role!=='admin' && project.ownerId!==user.id)) throw new Error('No tienes acceso al proyecto.');
 Object.assign(project,patch,{history:[{action,date:new Date().toISOString(),actor:user.name},...(project.history||[])]});
 sessionStorage.setItem(KEY,JSON.stringify(items));
}
export function reviewDemoProject(id:string, decision:'approve'|'corrections', text:string) {
 if(getDemoUser()?.role!=='admin')throw new Error('Se requiere un administrador.');
 const p=allProjects().find(item=>item.id===id);
 if(!p || p.status!=='pending')throw new Error('Esta solicitud ya no está pendiente.');
 if(decision==='approve' && text!==p.submission.repo)throw new Error('Escribe exactamente el nombre del repositorio.');
 if(decision==='corrections' && !text.trim())throw new Error('Explica las correcciones necesarias.');
 updateDemoProject(id,decision==='approve'?{status:'ci_pending',observation:undefined}:{status:'corrections',observation:text.trim()},decision==='approve'?'Proyecto validado. CI pendiente.':`Correcciones solicitadas: ${text.trim()}`);
}
export function submitDemoProject(draft: ProjectDraft) {
  if (!getDemoUser()) throw new Error('La admisión real todavía no está conectada.');
  const items = allProjects();
  if (items.some(item => item.slug === draft.name || item.submission.repo === draft.repo)) throw new Error('Ya registraste ese nombre o repositorio.');
  const project: DemoProject = { id: crypto.randomUUID(), name: draft.name, slug: draft.name, repo_url: `https://github.com/${draft.repo}`, branch: draft.branch, status: 'pending', domain: null, webhook_url: null, created_at: new Date().toISOString(), submission: { ...draft }, owner: getDemoUser()!.name, ownerId: getDemoUser()!.id, history: [{action: 'Proyecto enviado a aprobación', date: new Date().toISOString(), actor: getDemoUser()!.name}] };
  sessionStorage.setItem(KEY, JSON.stringify([project, ...items]));
}
