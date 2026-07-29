use std::env;

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub jwt_secret: String,
    pub jwt_expiry_hours: i64,
    pub kube_config_path: String,
    pub domain_suffix: String,
    pub kubero_namespace: String,
    pub registry_url: String,
    pub host: String,
    pub port: u16,
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
        }
    }
}
