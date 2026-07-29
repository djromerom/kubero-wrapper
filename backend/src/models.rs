use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub github_id: Option<String>,
    pub name: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserResponse,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub role: String,
}

impl From<User> for UserResponse {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Project {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub slug: String,
    pub repo_url: String,
    pub branch: String,
    pub status: String,
    pub domain: Option<String>,
    pub webhook_secret: Option<String>,
    pub kubero_pipeline: Option<String>,
    pub kubero_app: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub repo_url: String,
    #[serde(default = "default_branch")]
    pub branch: String,
}

fn default_branch() -> String {
    "main".into()
}

#[derive(Debug, Serialize)]
pub struct ProjectResponse {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub repo_url: String,
    pub branch: String,
    pub status: String,
    pub domain: Option<String>,
    pub webhook_url: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<Project> for ProjectResponse {
    fn from(p: Project) -> Self {
        Self {
            id: p.id,
            name: p.name,
            slug: p.slug,
            repo_url: p.repo_url,
            branch: p.branch,
            status: p.status,
            domain: p.domain.clone(),
            webhook_url: p.webhook_secret.map(|_| {
                format!("/api/webhook/{}", p.id)
            }),
            created_at: p.created_at,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Build {
    pub id: Uuid,
    pub project_id: Uuid,
    pub status: String,
    pub logs: Option<String>,
    pub commit_sha: Option<String>,
    pub commit_message: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct BuildResponse {
    pub id: Uuid,
    pub project_id: Uuid,
    pub status: String,
    pub logs: Option<String>,
    pub commit_sha: Option<String>,
    pub commit_message: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl From<Build> for BuildResponse {
    fn from(b: Build) -> Self {
        Self {
            id: b.id,
            project_id: b.project_id,
            status: b.status,
            logs: b.logs,
            commit_sha: b.commit_sha,
            commit_message: b.commit_message,
            started_at: b.started_at,
            completed_at: b.completed_at,
            created_at: b.created_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ClusterStatus {
    pub nodes: usize,
    pub pods: usize,
    pub cpu_usage: f64,
    pub memory_usage: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub role: String,
    pub exp: usize,
    pub iat: usize,
}
