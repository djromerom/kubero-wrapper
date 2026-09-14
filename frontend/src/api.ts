const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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

export interface GithubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url?: string;
}

export interface GithubBranch {
  name: string;
}

export interface GithubRepositoriesResponse {
  repositories: GithubRepository[];
}

export interface GithubBranchesResponse {
  owner: string;
  repository: string;
  branches: GithubBranch[];
}

export interface GithubLatestCommitResponse {
  owner: string;
  repository: string;
  branch: string;
  commit: {
    sha: string;
    commit: {
      message: string;
    };
  };
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

  githubConnect: () => {
    window.location.assign('/api/github/connect');
  },

  listGithubRepositories: () =>
    request<GithubRepositoriesResponse>('/github/repositories'),

  listGithubBranches: (owner: string, repo: string) =>
    request<GithubBranchesResponse>(`/github/repositories/${owner}/${repo}/branches`),

  getLatestCommit: (owner: string, repo: string, branch: string) =>
    request<GithubLatestCommitResponse>(`/github/repositories/${owner}/${repo}/latest-commit?branch=${encodeURIComponent(branch)}`),

  adminListProjects: () => request<Project[]>('/admin/projects'),

  adminDeleteProject: (id: string) =>
    request<void>(`/admin/projects/${id}`, { method: 'DELETE' }),

  clusterStatus: () => request<ClusterStatus>('/admin/cluster'),
};
