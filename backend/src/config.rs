use std::env;

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub jwt_secret: String,
    pub jwt_expiry_hours: i64,
    pub kube_config_path: String,
    pub kubernetes_required: bool,
    pub domain_suffix: String,
    pub kubero_namespace: String,
    pub registry_url: String,
    pub host: String,
    pub port: u16,
    pub frontend_url: String,
    pub github_app_id: String,
    pub github_app_slug: String,
    pub github_client_id: String,
    pub github_client_secret: String,
    pub github_callback_url: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/kubero_wrapper".into()),
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".into()),
            jwt_secret: env::var("JWT_SECRET")
                .unwrap_or_else(|_| "super-secret-key-change-in-production".into()),
            jwt_expiry_hours: env::var("JWT_EXPIRY_HOURS")
                .unwrap_or_else(|_| "24".into())
                .parse()
                .unwrap_or(24),
            kube_config_path: env::var("KUBE_CONFIG_PATH")
                .unwrap_or_else(|_| "/app/kubeconfig".into()),
            kubernetes_required: env::var("KUBERNETES_REQUIRED")
                .map(|value| value.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            domain_suffix: env::var("DOMAIN_SUFFIX")
                .unwrap_or_else(|_| "estudiantes.cluster.local".into()),
            kubero_namespace: env::var("KUBERO_NAMESPACE")
                .unwrap_or_else(|_| "kubero".into()),
            registry_url: env::var("REGISTRY_URL")
                .unwrap_or_else(|_| "192.168.1.201:5000".into()),
            host: env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: env::var("PORT")
                .unwrap_or_else(|_| "3000".into())
                .parse()
                .unwrap_or(3000),
            frontend_url: env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "http://localhost:5173".into()),
            github_app_id: env::var("GITHUB_APP_ID").unwrap_or_default(),
            github_app_slug: env::var("GITHUB_APP_SLUG").unwrap_or_default(),
            github_client_id: env::var("GITHUB_CLIENT_ID").unwrap_or_default(),
            github_client_secret: env::var("GITHUB_CLIENT_SECRET").unwrap_or_default(),
            github_callback_url: env::var("GITHUB_CALLBACK_URL").unwrap_or_else(|_| {
                "http://localhost:3000/api/github/callback".into()
            }),
        }
    }
}
