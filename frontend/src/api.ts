import { clusterDemo } from './demoFixtures';
import { listDemoProjects } from './demoProjects';
import { getDemoUser } from './demoSession';
const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (getDemoUser()) {
    if(path === '/admin/cluster' && getDemoUser()?.role === 'admin') return clusterDemo as T;
    if (!options.method && (path === '/projects' || path === '/admin/projects')) return listDemoProjects(path === '/admin/projects') as T;
    if (!options.method && path.startsWith('/projects/')) {
      const parts = path.split('/');
      const project = listDemoProjects(true).find(item => item.id === parts[2]);
      if (project && parts.length === 3) return project as T;
      if (project && parts[3] === 'builds') return (project.builds || []) as T;
    }
    throw new Error('Esta operación requiere la conexión real. Estás en modo de demostración.');
  }
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  repo_url: string;
  branch: string;
  status: string;
  domain: string | null;
  webhook_url: string | null;
  created_at: string;
}

export interface Build {
  id: string;
  project_id: string;
  status: string;
  logs: string | null;
  commit_sha: string | null;
  commit_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ClusterStatus {
  nodes: number;
  pods: number;
  cpu_usage: number;
  memory_usage: number;
}

export interface DeploymentStatus {
  project_id: string;
  project_name: string;
  slug: string;
  domain: string | null;
  kubero_status: {
    name: string;
    namespace: string;
    status: {
      phase: string;
      conditions: any[];
      replicas: number;
      availableReplicas: number;
      updatedReplicas: number;
      url: string | null;
    };
    ingress: any;
  } | null;
  message?: string;
}

export interface GithubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url?: string;
}

export interface GithubBranch { name: string }
export interface GithubStatus { linked: boolean; login?: string; github_user_id?: number }
export interface GithubRepositoriesResponse { repositories: GithubRepository[] }
export interface GithubBranchesResponse { owner: string; repository: string; branches: GithubBranch[] }
export interface GithubLatestCommitResponse {
  owner: string;
  repository: string;
  branch: string;
  commit: { sha: string; commit: { message: string } };
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  register: (data: { email: string; password: string; name: string }) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  listProjects: () => request<Project[]>('/projects'),

  getProject: (id: string) => request<Project>(`/projects/${id}`),

  createProject: (data: { name: string; repo_url: string; branch?: string }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),

  deleteProject: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),

  listBuilds: (projectId: string) =>
    request<Build[]>(`/projects/${projectId}/builds`),

  getWebhook: (id: string) =>
    request<{ webhook_url: string; webhook_secret: string }>(`/projects/${id}/webhook`),

  githubStatus: () => request<GithubStatus>('/github/status'),

  githubConnect: async () => {
    const { authorization_url } = await request<{ authorization_url: string }>('/github/connect');
    window.location.assign(authorization_url);
  },

  githubDisconnect: () =>
    request<void>('/github/disconnect', { method: 'DELETE' }),

  listGithubRepositories: () =>
    request<GithubRepositoriesResponse>('/github/repositories'),

  listGithubBranches: (owner: string, repo: string) =>
    request<GithubBranchesResponse>(`/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`),

  getLatestGithubCommit: (owner: string, repo: string, branch: string) =>
    request<GithubLatestCommitResponse>(`/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/latest-commit?branch=${encodeURIComponent(branch)}`),

  adminListProjects: () => request<Project[]>('/admin/projects'),

  adminDeleteProject: (id: string) =>
    request<void>(`/admin/projects/${id}`, { method: 'DELETE' }),

  clusterStatus: () => request<ClusterStatus>('/admin/cluster'),

  getDeploymentStatus: (id: string) =>
    request<DeploymentStatus>(`/projects/${id}/deployment-status`),
};
