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

#[derive(Debug, FromRow)]
pub struct GitHubAccount {
    pub user_id: Uuid,
    pub github_user_id: i64,
    pub github_login: String,
    pub access_token: String,
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
    #[sqlx(default)]
    pub deletion_requested_at: Option<DateTime<Utc>>,
    #[sqlx(default)]
    pub deletion_error: Option<String>,
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub slug: String,
    pub repo_url: String,
    pub branch: String,
    pub status: String,
    #[sqlx(default)]
    pub requested_subdomain: Option<String>,
    #[sqlx(default)]
    pub purpose: Option<String>,
    #[sqlx(default)]
    pub course: Option<String>,
    #[sqlx(default)]
    pub review_note: Option<String>,
    #[sqlx(default)]
    pub correction_fields: Vec<String>,
    #[sqlx(default)]
    pub source_commit: Option<String>,
    #[sqlx(default)]
    pub adaptation_report: Option<serde_json::Value>,
    #[sqlx(default)]
    pub approved_image: Option<String>,
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
    #[serde(default)]
    pub requested_subdomain: String,
    pub purpose: String,
    #[serde(default)]
    pub course: Option<String>,
    #[serde(default)]
    pub deployment_config: DeploymentConfig,
}

#[derive(Debug, Deserialize)]
pub struct SubdomainQuery {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DeploymentConfig {
    pub port: u16,
    pub health_path: String,
    pub build_env: std::collections::BTreeMap<String, String>,
    pub runtime_env: std::collections::BTreeMap<String, String>,
    pub postgres: bool,
    pub redis: bool,
    pub migration_command: String,
    pub worker_command: String,
}

impl Default for DeploymentConfig {
    fn default() -> Self {
        Self { port: 3000, health_path: "/".into(), build_env: Default::default(),
            runtime_env: Default::default(), postgres: false, redis: false,
            migration_command: String::new(), worker_command: String::new() }
    }
}

impl DeploymentConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.port == 0 || !self.health_path.starts_with('/') || self.health_path.starts_with("//")
            || self.health_path.len() > 256 || self.health_path.chars().any(char::is_control) {
            return Err("Revisa el puerto y la ruta de comprobación HTTP.".into());
        }
        for (is_build, values) in [(true, &self.build_env), (false, &self.runtime_env)] {
            if values.len() > 50 { return Err("Máximo 50 variables por sección.".into()); }
            for (key, value) in values {
                if key.is_empty() || key.len() > 100 || !key.bytes().enumerate().all(|(i, c)|
                    c == b'_' || c.is_ascii_alphabetic() || (i > 0 && c.is_ascii_digit()))
                    || value.len() > 8192 || value.contains('\0') {
                    return Err("Nombre o valor de variable no válido.".into());
                }
                if is_build && !["NEXT_PUBLIC_", "PUBLIC_", "VITE_"].iter().any(|prefix| key.starts_with(prefix)) {
                    return Err("Las variables de construcción deben ser públicas: NEXT_PUBLIC_, PUBLIC_ o VITE_.".into());
                }
                if !is_build && ["PORT", "HOST", "NODE_ENV"].contains(&key.as_str()) {
                    return Err("PORT, HOST y NODE_ENV los gestiona Atlas.".into());
                }
                if !is_build && ((self.postgres && key == "DATABASE_URL") || (self.redis && ["REDIS_URL", "REDIS_HOST", "REDIS_PORT"].contains(&key.as_str()))) {
                    return Err("Atlas configura automáticamente las variables de los servicios seleccionados.".into());
                }
            }
        }
        if self.migration_command.len() > 1000 || self.worker_command.len() > 1000
            || self.migration_command.contains('\0') || self.worker_command.contains('\0') {
            return Err("El comando es demasiado largo o contiene caracteres no válidos.".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod deployment_tests {
    use super::DeploymentConfig;

    #[test]
    fn defaults_and_public_variables_are_valid() {
        let mut config = DeploymentConfig::default();
        assert!(config.validate().is_ok());
        config.build_env.insert("NEXT_PUBLIC_API_URL".into(), "https://example.test/api?a=1&b=2".into());
        assert!(config.validate().is_ok());
    }

    #[test]
    fn server_secrets_cannot_be_sent_as_public_build_values() {
        let mut config = DeploymentConfig::default();
        config.build_env.insert("JWT_SECRET".into(), "secret".into());
        assert!(config.validate().is_err());
        config.build_env.clear();
        config.runtime_env.insert("JWT_SECRET".into(), "secret".into());
        assert!(config.validate().is_ok());
    }

    #[test]
    fn managed_connections_and_invalid_health_paths_are_rejected() {
        let mut config = DeploymentConfig::default();
        config.postgres = true;
        config.runtime_env.insert("DATABASE_URL".into(), "external".into());
        assert!(config.validate().is_err());
        config.runtime_env.clear();
        config.health_path = "//external.test".into();
        assert!(config.validate().is_err());
        config.health_path = "/api/docs".into();
        assert!(config.validate().is_ok());
        config.port = 0;
        assert!(config.validate().is_err());
    }
}

#[derive(Debug, Serialize)]
pub struct SubdomainAvailability {
    pub available: bool,
}

#[derive(Debug, Deserialize)]
pub struct ReviewProjectRequest {
    pub decision: String,
    #[serde(default, alias = "text")]
    pub note: Option<String>,
    #[serde(default)]
    pub correction_fields: Vec<String>,
}

pub const PROJECT_CORRECTION_FIELDS: [&str; 6] = [
    "name", "repo_url", "branch", "purpose", "requested_subdomain", "course",
];

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResubmitProjectRequest {
    pub name: Option<String>,
    pub repo_url: Option<String>,
    pub branch: Option<String>,
    pub purpose: Option<String>,
    pub requested_subdomain: Option<String>,
    pub course: Option<String>,
}

impl ResubmitProjectRequest {
    pub fn validate_selection(&self, selected: &[String]) -> Result<(), String> {
        if selected.is_empty() {
            return Err("La solicitud no tiene campos de corrección definidos.".into());
        }
        let supplied = [
            ("name", self.name.is_some()), ("repo_url", self.repo_url.is_some()),
            ("branch", self.branch.is_some()), ("purpose", self.purpose.is_some()),
            ("requested_subdomain", self.requested_subdomain.is_some()), ("course", self.course.is_some()),
        ];
        for (field, present) in supplied {
            let required = selected.iter().any(|selected| selected == field)
                || (field == "branch" && selected.iter().any(|selected| selected == "repo_url"));
            if required && !present {
                return Err(format!("Completa el campo solicitado: {field}."));
            }
            if present && !required {
                return Err(format!("El campo {field} no fue solicitado para corrección."));
            }
        }
        Ok(())
    }
}

fn default_branch() -> String {
    "main".into()
}

#[cfg(test)]
mod correction_tests {
    use super::ResubmitProjectRequest;
    use serde_json::json;

    #[test]
    fn resubmission_requires_exactly_the_requested_fields() {
        let selected = vec!["name".into(), "purpose".into()];
        let valid: ResubmitProjectRequest = serde_json::from_value(json!({"name":"Cronómetro", "purpose":"Descripción corregida"})).unwrap();
        assert!(valid.validate_selection(&selected).is_ok());
        let missing: ResubmitProjectRequest = serde_json::from_value(json!({"purpose":"Descripción corregida"})).unwrap();
        assert!(missing.validate_selection(&selected).is_err());
        let extra: ResubmitProjectRequest = serde_json::from_value(json!({"name":"Cronómetro", "purpose":"Descripción corregida", "course":"Otro"})).unwrap();
        assert!(extra.validate_selection(&selected).is_err());
        assert!(valid.validate_selection(&[]).is_err());
    }

    #[test]
    fn changing_repository_requires_its_branch_and_allows_clearing_course() {
        let missing_branch: ResubmitProjectRequest = serde_json::from_value(json!({"repo_url":"https://github.com/owner/project"})).unwrap();
        assert!(missing_branch.validate_selection(&["repo_url".into()]).is_err());
        let source: ResubmitProjectRequest = serde_json::from_value(json!({"repo_url":"https://github.com/owner/project", "branch":"main"})).unwrap();
        assert!(source.validate_selection(&["repo_url".into()]).is_ok());
        let clear: ResubmitProjectRequest = serde_json::from_value(json!({"course":""})).unwrap();
        assert!(clear.validate_selection(&["course".into()]).is_ok());
        assert!(serde_json::from_value::<ResubmitProjectRequest>(json!({"deployment_config":{}})).is_err());
    }
}

#[derive(Debug, Serialize)]
pub struct ProjectResponse {
    pub deletion_requested_at: Option<DateTime<Utc>>,
    pub deletion_error: Option<String>,
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub repo_url: String,
    pub branch: String,
    pub status: String,
    pub requested_subdomain: Option<String>,
    pub purpose: Option<String>,
    pub course: Option<String>,
    pub review_note: Option<String>,
    pub correction_fields: Vec<String>,
    pub source_commit: Option<String>,
    pub adaptation_report: Option<serde_json::Value>,
    pub domain: Option<String>,
    pub webhook_url: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<Project> for ProjectResponse {
    fn from(p: Project) -> Self {
        Self {
            id: p.id,
            deletion_requested_at: p.deletion_requested_at,
            deletion_error: p.deletion_error,
            name: p.name,
            slug: p.slug,
            repo_url: p.repo_url,
            branch: p.branch,
            status: p.status,
            requested_subdomain: p.requested_subdomain,
            purpose: p.purpose,
            course: p.course,
            review_note: p.review_note,
            correction_fields: p.correction_fields,
            source_commit: p.source_commit,
            adaptation_report: p.adaptation_report,
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
