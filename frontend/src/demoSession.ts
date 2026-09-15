import type { User } from './api';

const KEY = 'atlas.demo.role';
const GITHUB_KEY = 'atlas.demo.github-linked';
export type DemoRole = 'admin' | 'developer';
export function getDemoUser(): User | null {
  const role = sessionStorage.getItem(KEY);
  if (role !== 'admin' && role !== 'developer') return null;
  return { id: `demo-${role}`, name: role === 'admin' ? 'Administrador demo' : 'Desarrollador demo', email: '', role };
}
export function startDemo(role: DemoRole) {
  sessionStorage.setItem(KEY, role);
  sessionStorage.removeItem(GITHUB_KEY);
}
export function isDemoGithubLinked() { return sessionStorage.getItem(GITHUB_KEY) === 'true'; }
export function linkDemoGithub() { sessionStorage.setItem(GITHUB_KEY, 'true'); }
export function endDemo() {
  sessionStorage.removeItem(KEY);
  sessionStorage.removeItem(GITHUB_KEY);
}
