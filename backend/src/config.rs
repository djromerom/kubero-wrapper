use std::env;

#[derive(Clone)]
pub struct Config {
    pub ci: crate::ci_clients::CiConfig,
    pub github_api_url: String,
    pub database_url: String,
    pub redis_url: String,
    pub jwt_secret: String,
    pub jwt_expiry_hours: i64,
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
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            ci: crate::ci_clients::CiConfig::from_env()?,
            github_api_url: env::var("GITHUB_API_URL").unwrap_or_else(|_| "https://api.github.com".into()).trim_end_matches('/').into(),
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
        })
    }
}

/// External secret mounts and direct environment values are mutually exclusive.
pub fn secret(name: &str) -> anyhow::Result<String> {
    resolve_secret(name, &env::var(name).unwrap_or_default(), &env::var(format!("{name}_FILE")).unwrap_or_default())
}

fn resolve_secret(name: &str, value: &str, file: &str) -> anyhow::Result<String> {
    use std::io::Read;
    anyhow::ensure!(value.is_empty() || file.is_empty(), "Configura sólo {name} o {name}_FILE");
    if file.is_empty() { return Ok(value.into()); }
    let mut bytes = Vec::new();
    let result = std::fs::File::open(file).and_then(|f| f.take(65537).read_to_end(&mut bytes));
    anyhow::ensure!(result.is_ok() && bytes.len() <= 65536, "No se pudo cargar {name}_FILE");
    let value = String::from_utf8(bytes).map_err(|_| anyhow::anyhow!("{name}_FILE debe ser UTF-8"))?;
    let value = value.trim_end_matches(['\r', '\n']);
    anyhow::ensure!(!value.is_empty(), "{name}_FILE está vacío");
    Ok(value.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_secret_files_fail_closed_without_disclosing_values() {
        let path = std::env::temp_dir().join(format!("atlas-secret-{}", uuid::Uuid::new_v4()));
        let file = path.to_str().unwrap();
        assert_eq!(resolve_secret("TOKEN", "direct", "").unwrap(), "direct");
        assert!(resolve_secret("TOKEN", "sensitive", file).unwrap_err().to_string().contains("sólo"));
        assert!(resolve_secret("TOKEN", "", file).is_err());
        std::fs::write(&path, "external-secret\r\n").unwrap();
        assert_eq!(resolve_secret("TOKEN", "", file).unwrap(), "external-secret");
        for content in [vec![], vec![b'a'; 65537], vec![255]] {
            std::fs::write(&path, content).unwrap();
            assert!(resolve_secret("TOKEN", "", file).is_err());
        }
        std::fs::remove_file(path).unwrap();
    }
}
