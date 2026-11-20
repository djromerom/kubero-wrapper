//! Woodpecker v3.18 and OCI Distribution clients. No Kubernetes or publishing credentials.
use std::{env, time::Duration};
use reqwest::{Client, Response, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[derive(Clone)]
pub struct CiConfig {
    pub enabled: bool,
    pub central_ready: bool,
    pub mode: String,
    pub woodpecker_url: String,
    pub woodpecker_token: String,
    pub expected_author: String,
    pub registry_url: String,
    pub registry_namespace: String,
    pub registry_user: String,
    pub registry_password: String,
    pub registry_token: String,
    pub registry_ca_file: String,
    pub authorization_token: String,
    pub publication_token: String,
    pub test_repository: String,
    pub allow_http_loopback: bool,
    pub timeout_seconds: u64,
    pub poll_seconds: u64,
    pub run_timeout_seconds: i64,
}

impl CiConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let value = |name: &str| env::var(name).unwrap_or_default();
        Ok(Self {
            enabled: value("ATLAS_CI_ENABLED") == "true",
            central_ready: value("ATLAS_CI_CENTRAL_READY") == "true",
            mode: env::var("ATLAS_CI_MODE").unwrap_or_else(|_| "central".into()),
            woodpecker_url: value("WOODPECKER_URL").trim_end_matches('/').into(),
            woodpecker_token: crate::config::secret("WOODPECKER_TOKEN")?,
            expected_author: value("WOODPECKER_EXPECTED_AUTHOR"),
            registry_url: value("ATLAS_REGISTRY_URL").trim_end_matches('/').into(),
            registry_namespace: env::var("ATLAS_REGISTRY_NAMESPACE").unwrap_or_else(|_| "atlas".into()),
            registry_user: value("ATLAS_REGISTRY_USERNAME"),
            registry_password: crate::config::secret("ATLAS_REGISTRY_PASSWORD")?,
            registry_token: crate::config::secret("ATLAS_REGISTRY_TOKEN")?,
            registry_ca_file: value("ATLAS_REGISTRY_CA_FILE"),
            authorization_token: crate::config::secret("ATLAS_CI_AUTHORIZATION_TOKEN")?,
            publication_token: crate::config::secret("ATLAS_CI_PUBLICATION_TOKEN")?,
            test_repository: value("ATLAS_CI_TEST_REPOSITORY"),
            allow_http_loopback: value("ATLAS_CI_ALLOW_HTTP_LOOPBACK") == "true",
            timeout_seconds: value("ATLAS_CI_HTTP_TIMEOUT_SECONDS").parse().unwrap_or(15).clamp(1, 60),
            poll_seconds: value("ATLAS_CI_POLL_SECONDS").parse().unwrap_or(5).clamp(1, 300),
            run_timeout_seconds: value("ATLAS_CI_RUN_TIMEOUT_SECONDS").parse().unwrap_or(3600).clamp(60, 86400),
        })
    }

    pub fn blocked_reason(&self, repo_url: &str) -> Option<&'static str> {
        if !self.enabled { return Some("CI pendiente de conexión con la infraestructura."); }
        if self.mode == "central" && !self.central_ready {
            return Some("La configuración central de CI todavía no está habilitada.");
        }
        if self.mode == "repository-test" && repo_url != self.test_repository {
            return Some("El modo de prueba sólo admite el repositorio piloto configurado.");
        }
        None
    }
}

pub fn secure_base(value: &str, loopback: bool) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "URL de integración no válida".to_string())?;
    let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if (url.scheme() != "https" && !(loopback && local && url.scheme() == "http"))
        || !url.username().is_empty() || url.password().is_some() || url.query().is_some()
        || url.fragment().is_some() || !matches!(url.path(), "" | "/") {
        return Err("Se requiere un origen HTTPS sin credenciales ni ruta".into());
    }
    Ok(url)
}

#[derive(Debug, Clone, Copy)]
pub enum RemoteError { Unavailable, Rejected, Invalid, Missing }
impl RemoteError {
    pub fn message(self) -> &'static str {
        match self {
            Self::Unavailable => "No se pudo consultar el servicio de CI o Registry. Se volverá a comprobar.",
            Self::Rejected => "El servicio rechazó la operación. Revisa permisos y configuración de infraestructura.",
            Self::Invalid => "La respuesta del servicio no cumple el contrato de CI.",
            Self::Missing => "El repositorio o la imagen todavía no está disponible en el servicio.",
        }
    }
}
type ResultRemote<T> = Result<T, RemoteError>;
fn transport(_: reqwest::Error) -> RemoteError { RemoteError::Unavailable }
async fn checked(response: Result<Response, reqwest::Error>) -> ResultRemote<Response> {
    let r = response.map_err(transport)?;
    match r.status().as_u16() {
        200..=299 => Ok(r), 404 => Err(RemoteError::Missing),
        408 | 429 | 500..=599 => Err(RemoteError::Unavailable),
        _ => Err(RemoteError::Rejected),
    }
}
async fn limited_bytes(mut response: Response) -> ResultRemote<Vec<u8>> {
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(transport)? {
        if data.len() + chunk.len() > 4 * 1024 * 1024 { return Err(RemoteError::Invalid); }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}
async fn decode<T: serde::de::DeserializeOwned>(response: Result<Response, reqwest::Error>) -> ResultRemote<T> {
    serde_json::from_slice(&limited_bytes(checked(response).await?).await?).map_err(|_| RemoteError::Invalid)
}

#[derive(Debug, Deserialize)]
pub struct Repository {
    pub id: i64,
    pub full_name: String,
    pub active: bool,
    pub forge_url: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Pipeline {
    pub id: i64,
    pub number: i64,
    // v3.18 deliberately omits repo_id in pipeline JSON. Scope comes from the requested URL.
    #[serde(skip)]
    pub repo_id: i64,
    pub author: String,
    pub commit: String,
    pub branch: String,
    pub event: String,
    pub status: String,
    #[serde(default)]
    pub message: String,
}

#[derive(Clone)]
pub struct CiClients { config: CiConfig, woodpecker: Client, registry: Client }
impl CiClients {
    pub fn new(config: CiConfig) -> anyhow::Result<Self> {
        for url in [&config.woodpecker_url, &config.registry_url] {
            secure_base(url, config.allow_http_loopback).map_err(anyhow::Error::msg)?;
        }
        anyhow::ensure!(!config.woodpecker_token.is_empty(), "Falta WOODPECKER_TOKEN");
        anyhow::ensure!(!config.expected_author.is_empty(), "Falta WOODPECKER_EXPECTED_AUTHOR (cuenta técnica)");
        anyhow::ensure!(matches!(config.mode.as_str(), "central" | "repository-test"), "ATLAS_CI_MODE no válido");
        anyhow::ensure!(config.mode != "central" || config.authorization_token.len() >= 32,
            "ATLAS_CI_AUTHORIZATION_TOKEN debe contener al menos 32 caracteres");
        anyhow::ensure!(config.mode != "central" || (config.publication_token.len() >= 32 && config.publication_token != config.authorization_token),
            "ATLAS_CI_PUBLICATION_TOKEN debe tener al menos 32 caracteres y ser distinto del token de configuración");
        anyhow::ensure!(valid_repository(&config.registry_namespace), "ATLAS_REGISTRY_NAMESPACE no válido");
        anyhow::ensure!(config.registry_token.is_empty() || config.registry_user.is_empty(), "Elige Basic o Bearer para Registry");
        anyhow::ensure!(config.registry_user.is_empty() == config.registry_password.is_empty(), "Registry Basic requiere usuario y contraseña");
        let builder = || Client::builder().redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(config.timeout_seconds));
        let woodpecker = builder().build()?;
        let mut registry = builder();
        if !config.registry_ca_file.is_empty() {
            let pem = std::fs::read(&config.registry_ca_file)?;
            registry = registry.add_root_certificate(reqwest::Certificate::from_pem(&pem)?);
        }
        Ok(Self { config, woodpecker, registry: registry.build()? })
    }

    pub async fn repository(&self, full_name: &str) -> ResultRemote<Repository> {
        if !valid_github_name(full_name) { return Err(RemoteError::Invalid); }
        let repo: Repository = decode(self.woodpecker.get(format!("{}/api/repos/lookup/{full_name}", self.config.woodpecker_url))
            .bearer_auth(&self.config.woodpecker_token).send().await).await?;
        if repo.id <= 0 || !repo.active || !repo.full_name.eq_ignore_ascii_case(full_name)
            || !repo.forge_url.eq_ignore_ascii_case(&format!("https://github.com/{full_name}")) {
            return Err(RemoteError::Rejected);
        }
        Ok(repo)
    }

    pub async fn trigger(&self, repo: i64, branch: &str, id: uuid::Uuid, sha: &str, image_repository: &str) -> ResultRemote<Pipeline> {
        let image = format!("{}/{image_repository}:{id}", self.config.registry_url.trim_start_matches("https://").trim_start_matches("http://"));
        let mut pipeline: Pipeline = decode(self.woodpecker.post(format!("{}/api/repos/{repo}/pipelines", self.config.woodpecker_url))
            .bearer_auth(&self.config.woodpecker_token)
            .json(&json!({"branch":branch, "message":format!("atlas:{id}"),
                "variables":{"ATLAS_RUN_ID":id.to_string(),"ATLAS_COMMIT_SHA":sha,
                    "ATLAS_IMAGE":image,"ATLAS_PLATFORM":"linux/arm64"}}))
            .send().await).await?;
        pipeline.repo_id = repo;
        Ok(pipeline)
    }

    pub async fn pipeline(&self, repo: i64, number: i64) -> ResultRemote<Pipeline> {
        let mut pipeline: Pipeline = decode(self.woodpecker.get(format!("{}/api/repos/{repo}/pipelines/{number}", self.config.woodpecker_url))
            .bearer_auth(&self.config.woodpecker_token).send().await).await?;
        pipeline.repo_id = repo;
        Ok(pipeline)
    }

    /// Reconcile an uncertain POST. Never repeat POST automatically: v3.18 has no idempotency key.
    pub async fn find_pipeline(&self, repo: i64, branch: &str, id: uuid::Uuid) -> ResultRemote<Option<Pipeline>> {
        let message = format!("MANUAL: atlas:{id} @ {branch}");
        let mut found = None;
        for page in 1..=20 {
            let rows: Vec<Pipeline> = decode(self.woodpecker.get(format!("{}/api/repos/{repo}/pipelines", self.config.woodpecker_url))
                .bearer_auth(&self.config.woodpecker_token)
                .query(&[("page",page.to_string()),("perPage","50".into()),("branch",branch.into()),("event","manual".into())])
                .send().await).await?;
            let last = rows.len() < 50;
            for mut row in rows {
                if row.message == message && row.author == self.config.expected_author {
                    row.repo_id = repo;
                    if found.is_some() { return Err(RemoteError::Invalid); }
                    found = Some(row);
                }
            }
            if last { return Ok(found); }
        }
        // An incomplete search must never be used as proof that no pipeline was created.
        Err(RemoteError::Unavailable)
    }

    pub fn image_repository(&self, project_id: uuid::Uuid) -> String {
        format!("{}/{}", self.config.registry_namespace, project_id)
    }
    pub fn image_reference(&self, repository: &str, digest: &str) -> String {
        format!("{}/{repository}@{digest}", self.config.registry_url.trim_start_matches("https://").trim_start_matches("http://"))
    }
    async fn registry_get(&self, path: &str) -> ResultRemote<Response> {
        let mut request = self.registry.get(format!("{}/v2/{path}", self.config.registry_url))
            .header("Accept", "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json");
        if !self.config.registry_token.is_empty() { request = request.bearer_auth(&self.config.registry_token); }
        else if !self.config.registry_user.is_empty() { request = request.basic_auth(&self.config.registry_user, Some(&self.config.registry_password)); }
        checked(request.send().await).await
    }
    async fn manifest(&self, repo: &str, reference: &str) -> ResultRemote<(String, Value)> {
        let response = self.registry_get(&format!("{repo}/manifests/{reference}")).await?;
        let header = response.headers().get("docker-content-digest").and_then(|h| h.to_str().ok()).ok_or(RemoteError::Invalid)?.to_owned();
        let bytes = limited_bytes(response).await?;
        let digest = digest(&bytes);
        if header != digest || (reference.starts_with("sha256:") && reference != digest) { return Err(RemoteError::Invalid); }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| RemoteError::Invalid)?;
        if value["schemaVersion"] != 2 { return Err(RemoteError::Invalid); }
        Ok((digest, value))
    }

    /// Verify content, not just the tag's existence. Follow an ARM64 index entry and its image config.
    pub async fn verify_image(&self, repo: &str, tag: &str) -> ResultRemote<String> {
        if !valid_repository(repo) || uuid::Uuid::parse_str(tag).is_err() { return Err(RemoteError::Invalid); }
        let (root_digest, mut manifest) = self.manifest(repo, tag).await?;
        if let Some(entries) = manifest["manifests"].as_array() {
            let child = entries.iter().find(|e| e["platform"]["os"] == "linux" && e["platform"]["architecture"] == "arm64")
                .and_then(|e| e["digest"].as_str()).filter(|d| valid_digest(d)).ok_or(RemoteError::Invalid)?.to_owned();
            manifest = self.manifest(repo, &child).await?.1;
        }
        let config = manifest["config"]["digest"].as_str().filter(|d| valid_digest(d)).ok_or(RemoteError::Invalid)?;
        let bytes = limited_bytes(self.registry_get(&format!("{repo}/blobs/{config}")).await?).await?;
        if digest(&bytes) != config { return Err(RemoteError::Invalid); }
        let config: Value = serde_json::from_slice(&bytes).map_err(|_| RemoteError::Invalid)?;
        if config["os"] != "linux" || config["architecture"] != "arm64" { return Err(RemoteError::Invalid); }
        Ok(root_digest)
    }
}
pub fn digest(bytes: &[u8]) -> String { format!("sha256:{:x}", Sha256::digest(bytes)) }
pub fn valid_digest(s: &str) -> bool { s.strip_prefix("sha256:").is_some_and(|v| v.len() == 64 && v.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())) }
pub fn valid_github_name(s: &str) -> bool { s.split('/').count() == 2 && s.split('/').all(|p| !p.is_empty() && p != "." && p != ".." && p.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))) }
fn valid_repository(s: &str) -> bool { !s.is_empty() && s.split('/').all(|p| !p.is_empty() && p != "." && p != ".." && p.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"-_.".contains(&c))) }

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get, Router};
    fn config(base: &str) -> CiConfig {
        CiConfig { enabled:true, central_ready:true, mode:"central".into(), woodpecker_url:base.into(),
            woodpecker_token:"test-token".into(), expected_author:"atlas-service".into(), registry_url:base.into(), registry_namespace:"atlas".into(),
            registry_user:String::new(), registry_password:String::new(), registry_token:String::new(),
            registry_ca_file:String::new(), authorization_token:"a".repeat(32), publication_token:"b".repeat(32), test_repository:String::new(),
            allow_http_loopback:true, timeout_seconds:1, poll_seconds:1, run_timeout_seconds:60 }
    }
    #[test]
    fn integration_configuration_fails_closed() {
        for url in ["http://10.10.10.10:5000","https://user:pass@example.test","https://example.test/path","https://example.test?token=x"] {
            assert!(secure_base(url,true).is_err());
        }
        assert!(secure_base("http://127.0.0.1:5000",false).is_err());
        assert!(secure_base("http://127.0.0.1:5000",true).is_ok());
        assert!(secure_base("https://10.10.10.10:5000",false).is_ok());
        let mut cfg=config("https://example.test");
        cfg.central_ready=false;
        assert!(cfg.blocked_reason("https://github.com/team/app").is_some());
        cfg.mode="repository-test".into(); cfg.test_repository="https://github.com/team/pilot".into();
        assert!(cfg.blocked_reason("https://github.com/team/app").is_some());
        assert!(cfg.blocked_reason("https://github.com/team/pilot").is_none());
        assert!(!valid_repository("../escape"));
        assert!(!valid_github_name("team/repo?token=x"));
    }
    #[tokio::test]
    async fn errors_and_redirects_do_not_expose_or_forward_tokens() {
        let app=Router::new().route("/api/repos/lookup/team/app", get(|| async {
            (axum::http::StatusCode::FOUND,[("location","http://127.0.0.1:1/steal")],"secret-response-body")
        }));
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base=format!("http://{}",listener.local_addr().unwrap());
        let server=tokio::spawn(async move { axum::serve(listener,app).await.unwrap(); });
        let client=CiClients::new(config(&base)).unwrap();
        let error=client.repository("team/app").await.unwrap_err();
        assert!(matches!(error,RemoteError::Rejected));
        assert!(!error.message().contains("secret"));
        server.abort();
    }

    /// Requires openssl (available in the Rust builder); only opens local sockets.
    #[tokio::test]
    async fn registry_tls_requires_trusted_ca_and_matching_hostname() {
        use std::process::{Command, Stdio};
        struct TlsServer(std::process::Child);
        impl Drop for TlsServer { fn drop(&mut self) { let _=self.0.kill(); let _=self.0.wait(); } }
        let dir=std::env::temp_dir().join(format!("atlas-tls-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let cert=dir.join("cert.pem"); let key=dir.join("key.pem");
        assert!(Command::new("openssl").args(["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost"])
            .arg("-keyout").arg(&key).arg("-out").arg(&cert).stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap().success());
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port=listener.local_addr().unwrap().port(); drop(listener);
        let server=TlsServer(Command::new("openssl").args(["s_server","-accept",&format!("127.0.0.1:{port}"),"-www","-quiet"])
            .arg("-cert").arg(&cert).arg("-key").arg(&key).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap());
        for _ in 0..50 { if tokio::net::TcpStream::connect(("127.0.0.1",port)).await.is_ok() { break; } tokio::time::sleep(Duration::from_millis(20)).await; }
        let base=format!("https://localhost:{port}");
        let client=CiClients::new(config(&base)).unwrap();
        assert!(client.registry.get(&base).send().await.is_err(),"untrusted certificate accepted");
        let mut cfg=config(&base); cfg.registry_ca_file=cert.to_str().unwrap().into();
        let client=CiClients::new(cfg).unwrap();
        assert!(client.registry.get(&base).send().await.unwrap().status().is_success());
        assert!(client.registry.get(format!("https://127.0.0.1:{port}")).send().await.is_err(),"hostname mismatch accepted");
        drop(server);
        assert!(dir.starts_with(std::env::temp_dir()));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
