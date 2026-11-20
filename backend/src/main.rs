mod auth;
mod ci;
mod ci_clients;
mod config;
mod db;
mod error;
mod events;
mod github;
mod models;
mod routes;
mod ws;

use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    dotenvy::dotenv().ok();

    let cfg = config::Config::from_env()?;
    if std::env::args().any(|arg| arg == "--check-ci-config") {
        anyhow::ensure!(!cfg.ci.enabled, "La comprobación offline requiere ATLAS_CI_ENABLED=false");
        anyhow::ensure!(!cfg.ci.allow_http_loopback, "La configuración de infraestructura requiere HTTPS");
        ci_clients::CiClients::new(cfg.ci.clone())?;
        println!("Configuración CI válida localmente. CI deshabilitado; sin conexiones externas ni migraciones.");
        return Ok(());
    }
    ci_clients::secure_base(&cfg.github_api_url, cfg.ci.allow_http_loopback)
        .map_err(anyhow::Error::msg)?;

    let pool = db::init_pool(&cfg.database_url).await?;
    db::run_migrations(&pool).await?;
    tracing::info!("Database migrations applied");

    let event_bus = events::EventBus::new(&cfg.redis_url).await;

    // CI phase: never connect to Kubernetes, including implicit in-cluster credentials.
    let ci_clients = if cfg.ci.enabled { Some(ci_clients::CiClients::new(cfg.ci.clone())?) } else { None };

    let ws_manager = ws::WsManager::new();

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let state = routes::AppState {
        config: cfg.clone(),
        db: pool,
        event_bus,
        ci_clients,
        ws_manager: ws_manager.clone(),
    };

    ci::start_worker(state.clone());
    let app = routes::create_router(state).layer(cors);

    let addr = SocketAddr::new(
        cfg.host.parse().unwrap_or_else(|_| "0.0.0.0".parse().unwrap()),
        cfg.port,
    );
    tracing::info!("Starting server on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
