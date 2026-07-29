use axum::{
    extract::{Path, State, WebSocketUpgrade, ws},
    http::StatusCode,
    middleware,
    response::IntoResponse,
    routing::{delete, get, post},
    Extension, Json, Router,
};
use serde_json::json;
use uuid::Uuid;

use crate::{
    auth::{self, AuthUser},
    config::Config,
    db,
    error::{AppError, AppResult},
    events::EventBus,
    kubero::KuberoManager,
    models::*,
    ws::WsManager,
};

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: sqlx::PgPool,
    pub event_bus: EventBus,
    pub kubero: KuberoManager,
    pub ws_manager: WsManager,
}

pub fn create_router(state: AppState) -> Router {
    let public_routes = Router::new()
        .route("/health", get(health_check))
        .route("/auth/register", post(register))
        .route("/auth/login", post(login));

    let protected_routes = Router::new()
        .route("/projects", get(list_projects).post(create_project))
        .route("/projects/{id}", get(get_project).delete(delete_project))
        .route("/projects/{id}/builds", get(list_builds))
        .route("/projects/{id}/webhook", get(get_webhook))
        .route("/ws", get(ws_handler))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::auth_middleware,
        ));

    let admin_routes = Router::new()
        .route("/admin/projects", get(admin_list_projects))
        .route("/admin/projects/{id}", delete(admin_delete_project))
        .route("/admin/cluster", get(cluster_status))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::auth_middleware,
        ))
        .route_layer(middleware::from_fn(auth::admin_middleware));

    let webhook_routes = Router::new()
        .route("/webhook/{project_id}", post(handle_webhook));

    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .merge(admin_routes)
        .merge(webhook_routes)
        .with_state(state)
}

async fn health_check(State(state): State<AppState>) -> Json<serde_json::Value> {
    let db_ok = sqlx::query("SELECT 1")
        .execute(&state.db)
        .await
        .is_ok();
    Json(json!({
        "status": if db_ok { "ok" } else { "degraded" },
        "version": env!("CARGO_PKG_VERSION"),
        "db": db_ok,
    }))
}

async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> AppResult<(StatusCode, Json<AuthResponse>)> {
    let existing = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE email = $1")
        .bind(&req.email)
        .fetch_one(&state.db)
        .await?;

    if existing > 0 {
        return Err(AppError::Conflict("Email already registered".into()));
    }

    let password_hash = auth::hash_password(&req.password)?;
    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING *",
    )
    .bind(&req.email)
    .bind(&password_hash)
    .bind(&req.name)
    .fetch_one(&state.db)
    .await?;

    let token = auth::create_jwt(
        user.id,
        &user.role,
        &state.config.jwt_secret,
        state.config.jwt_expiry_hours,
    )?;

    Ok((
        StatusCode::CREATED,
        Json(AuthResponse {
            token,
            user: user.into(),
        }),
    ))
}

async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> AppResult<Json<AuthResponse>> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(&req.email)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::Unauthorized)?;

    if !auth::verify_password(&req.password, &user.password_hash)? {
        return Err(AppError::Unauthorized);
    }

    let token = auth::create_jwt(
        user.id,
        &user.role,
        &state.config.jwt_secret,
        state.config.jwt_expiry_hours,
    )?;

    Ok(Json(AuthResponse {
        token,
        user: user.into(),
    }))
}

async fn create_project(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateProjectRequest>,
) -> AppResult<(StatusCode, Json<ProjectResponse>)> {
    let slug = slugify(&req.name);
    let webhook_secret = uuid::Uuid::new_v4().to_string();
    let domain = format!("{}.{}", slug, state.config.domain_suffix);

    let project = sqlx::query_as::<_, Project>(
        "INSERT INTO projects (user_id, name, slug, repo_url, branch, domain, webhook_secret) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
    )
    .bind(auth_user.id)
    .bind(&req.name)
    .bind(&slug)
    .bind(&req.repo_url)
    .bind(&req.branch)
    .bind(&domain)
    .bind(&webhook_secret)
    .fetch_one(&state.db)
    .await?;

    state.event_bus.publish("project.created", &json!({
        "project_id": project.id,
        "user_id": project.user_id,
        "slug": project.slug,
        "repo_url": project.repo_url,
        "branch": project.branch,
        "domain": project.domain,
    })).await;

    Ok((StatusCode::CREATED, Json(project.into())))
}

async fn list_projects(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<Vec<ProjectResponse>>> {
    let projects = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE user_id = $1 AND status != 'deleted' ORDER BY created_at DESC",
    )
    .bind(auth_user.id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(projects.into_iter().map(|p| p.into()).collect()))
}

async fn get_project(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<ProjectResponse>> {
    let project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE id = $1 AND user_id = $2 AND status != 'deleted'",
    )
    .bind(id)
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(project.into()))
}

async fn delete_project(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    sqlx::query("UPDATE projects SET status = 'deleted' WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;

    state.event_bus.publish("project.deleted", &json!({
        "project_id": project.id,
        "kubero_pipeline": project.kubero_pipeline,
        "kubero_app": project.kubero_app,
    })).await;

    Ok(StatusCode::NO_CONTENT)
}

async fn list_builds(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(project_id): Path<Uuid>,
) -> AppResult<Json<Vec<BuildResponse>>> {
    let builds = sqlx::query_as::<_, Build>(
        "SELECT b.* FROM builds b \
         JOIN projects p ON p.id = b.project_id \
         WHERE b.project_id = $1 AND p.user_id = $2 \
         ORDER BY b.created_at DESC LIMIT 50",
    )
    .bind(project_id)
    .bind(auth_user.id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(builds.into_iter().map(|b| b.into()).collect()))
}

async fn get_webhook(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE id = $1 AND user_id = $2 AND status != 'deleted'",
    )
    .bind(id)
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(json!({
        "webhook_url": format!("/api/webhook/{}", project.id),
        "webhook_secret": project.webhook_secret,
    })))
}

async fn handle_webhook(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    headers: axum::http::HeaderMap,
    body: String,
) -> AppResult<StatusCode> {
    let project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE id = $1 AND status != 'deleted'",
    )
    .bind(project_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    let signature = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let event = headers
        .get("x-github-event")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("push");

    sqlx::query(
        "INSERT INTO webhook_events (project_id, event_type, payload, signature_valid) \
         VALUES ($1, $2, $3::jsonb, $4)",
    )
    .bind(project_id)
    .bind(event)
    .bind(&body)
    .bind(false)
    .execute(&state.db)
    .await?;

    state.event_bus.publish("webhook.received", &json!({
        "project_id": project_id,
        "event": event,
    })).await;

    Ok(StatusCode::OK)
}

async fn admin_list_projects(
    State(state): State<AppState>,
) -> AppResult<Json<Vec<ProjectResponse>>> {
    let projects = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE status != 'deleted' ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(projects.into_iter().map(|p| p.into()).collect()))
}

async fn admin_delete_project(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;

    sqlx::query("UPDATE projects SET status = 'deleted' WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;

    state.event_bus.publish("project.deleted", &json!({
        "project_id": project.id,
        "kubero_pipeline": project.kubero_pipeline,
        "kubero_app": project.kubero_app,
    })).await;

    Ok(StatusCode::NO_CONTENT)
}

async fn cluster_status(State(state): State<AppState>) -> AppResult<Json<ClusterStatus>> {
    let status = state.kubero.get_cluster_status().await?;
    Ok(Json(status))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| state.ws_manager.handle_socket(socket, auth_user.id))
}

fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}
