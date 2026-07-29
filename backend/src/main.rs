mod auth;
mod config;
mod db;
mod error;
mod events;
mod kubero;
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

    let cfg = config::Config::from_env();

    let pool = db::init_pool(&cfg.database_url).await?;
    db::run_migrations(&pool).await?;
    tracing::info!("Database migrations applied");

    let event_bus = events::EventBus::new(&cfg.redis_url);

    let kubero = match kubero::KuberoManager::new_in_cluster().await {
        Ok(m) => {
            tracing::info!("Connected to Kubernetes cluster (in-cluster)");
            m
        }
        Err(_) => {
            tracing::warn!("No in-cluster config, trying kubeconfig file");
            kubero::KuberoManager::new(&cfg.kube_config_path).await?
        }
    };

    let ws_manager = ws::WsManager::new();

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let state = routes::AppState {
        config: cfg.clone(),
        db: pool,
        event_bus,
        kubero,
        ws_manager: ws_manager.clone(),
    };

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
