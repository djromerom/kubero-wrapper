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
  requested_subdomain?: string | null;
  purpose?: string | null;
  course?: string | null;
  review_note?: string | null;
  source_commit?: string | null;
  adaptation_report?: {
    outcome: string;
    summary?: string;
    commit?: string;
    platform?: string;
    build_strategy?: string;
    changes?: string[];
    port?: number;
    engine?: string;
    kubero_build?: string;
    kubero_job?: string;
    kubero_namespace?: string;
    build_verified: boolean;
    runtime_verified?: boolean;
    components?: { path: string; framework: string }[];
    blockers?: string[];
    warnings?: string[];
  } | null;
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

export interface DeploymentConfig {
  port: number;
  health_path: string;
  build_env: Record<string, string>;
  runtime_env: Record<string, string>;
  postgres: boolean;
  redis: boolean;
  migration_command: string;
  worker_command: string;
}

export const defaultDeploymentConfig: DeploymentConfig = {
  port: 3000,
  health_path: '/',
  build_env: {},
  runtime_env: {},
  postgres: false,
  redis: false,
  migration_command: '',
  worker_command: '',
};

export interface RuntimeLog {
  pod: string;
  container: string;
  logs: string;
}

export interface DeploymentStatus {
  project_id: string;
  project_name: string;
  slug: string;
  domain: string | null;
  cluster_configured: boolean;
  kubero_status: {
    name: string;
    namespace: string;
    status: {
      phase: string;
      conditions: Array<{
        type: string;
        status: string;
        reason?: string;
        message?: string;
      }>;
      replicas: number;
      availableReplicas: number;
      readyReplicas: number;
      url: string | null;
    };
    ingress: any;
  } | null;
  events: K8sEvent[];
  message?: string;
}

export interface K8sEvent {
  type: string;
  reason: string;
  message: string;
  first_timestamp: string | null;
  last_timestamp: string | null;
  count: number | null;
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
export interface GithubStatus {
  linked: boolean;
  login?: string;
  github_user_id?: number;
}
export interface GithubRepositoriesResponse {
  repositories: GithubRepository[];
}
export interface GithubBranchesResponse {
  owner: string;
  repository: string;
  branches: GithubBranch[];
}
export const api = {
  retryAdaptation: (id: string) =>
    request<void>(`/projects/${id}/adaptation/retry`, { method: 'POST' }),
  health: () => request<{ status: string }>('/health'),

  register: (data: { email: string; password: string; name: string }) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  listProjects: () => request<Project[]>('/projects', { cache: 'no-store' }),

  getProject: (id: string) => request<Project>(`/projects/${id}`, { cache: 'no-store' }),

  createProject: (data: {
    name: string;
    repo_url: string;
    branch: string;
    requested_subdomain: string;
    purpose: string;
    course?: string;
    deployment_config?: DeploymentConfig;
  }) => request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),

  subdomainAvailability: (name: string) =>
    request<{ available: boolean }>(`/subdomains/availability?name=${encodeURIComponent(name)}`),

  resubmitProject: (id: string, purpose: string) =>
    request<Project>(`/projects/${id}/resubmit`, {
      method: 'POST',
      body: JSON.stringify({ purpose }),
    }),

  getConfiguration: (id: string) =>
    request<DeploymentConfig>(`/projects/${id}/configuration`, { cache: 'no-store' }),
  runtimeLogs: (id: string) =>
    request<RuntimeLog[]>(`/projects/${id}/runtime-logs`, { cache: 'no-store' }),

  saveConfiguration: (id: string, config: DeploymentConfig) =>
    request<void>(`/projects/${id}/configuration`, { method: 'PUT', body: JSON.stringify(config) }),

  reviewProject: (
    id: string,
    decision: 'approve' | 'corrections',
    note?: string,
    technicalCorrection = false
  ) =>
    request<Project>(`/admin/projects/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, note, technical_correction: technicalCorrection }),
    }),

  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),

  listBuilds: (projectId: string) =>
    request<Build[]>(`/projects/${projectId}/builds`, { cache: 'no-store' }),

  getWebhook: (id: string) =>
    request<{ webhook_url: string; webhook_secret: string }>(`/projects/${id}/webhook`),

  githubStatus: () => request<GithubStatus>('/github/status'),

  githubConnect: async () => {
    const { authorization_url } = await request<{ authorization_url: string }>('/github/connect');
    const url = new URL(authorization_url);
    // GitHub must let each Atlas account choose its own GitHub identity.
    url.searchParams.set('prompt', 'select_account');
    window.location.assign(url.toString());
  },

  githubDisconnect: () => request<void>('/github/disconnect', { method: 'DELETE' }),

  listGithubRepositories: () => request<GithubRepositoriesResponse>('/github/repositories'),

  listGithubBranches: (owner: string, repo: string) =>
    request<GithubBranchesResponse>(
      `/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`
    ),

  adminListProjects: () => request<Project[]>('/admin/projects', { cache: 'no-store' }),

  getDeploymentStatus: (id: string) =>
    request<DeploymentStatus>(`/projects/${id}/deployment-status`),
};
