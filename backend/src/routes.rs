use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
    http::StatusCode,
    middleware,
    response::IntoResponse,
    routing::{delete, get, post},
    Extension, Json, Router,
};
use serde_json::json;
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};
use uuid::Uuid;

use crate::{
    auth::{self, AuthUser},
    config::Config,
    error::{AppError, AppResult},
    events::EventBus,
    github,
    kubero::KuberoManager,
    models::*,
    ws::WsManager,
};

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: sqlx::PgPool,
    pub event_bus: EventBus,
    pub kubero: Option<KuberoManager>,
    pub ws_manager: WsManager,
}

pub fn create_router(state: AppState) -> Router {
    let public_routes = Router::new()
        .route("/api/health", get(health_check))
        .route("/api/auth/register", post(register))
        .route("/api/auth/login", post(login))
        .route("/api/github/callback", get(github::callback));

    let protected_routes = Router::new()
        .route("/api/projects", get(list_projects).post(create_project))
        .route("/api/subdomains/availability", get(subdomain_availability))
        .route("/api/projects/:id", get(get_project).delete(delete_project))
        .route("/api/projects/:id/resubmit", post(resubmit_project))
        .route("/api/projects/:id/deployment/retry", post(retry_deployment))
        .route("/api/projects/:id/configuration", get(get_project_configuration).put(save_project_configuration))
        .route("/api/projects/:id/runtime-logs", get(get_runtime_logs))
        .route("/api/projects/:id/builds", get(list_builds))
        .route("/api/projects/:id/webhook", get(get_webhook))
        .route("/api/projects/:id/deployment-status", get(get_deployment_status))
        .route("/api/ws", get(ws_handler))
        .route("/api/github/status", get(github::status))
        .route("/api/github/connect", get(github::connect))
        .route("/api/github/disconnect", delete(github::disconnect))
        .route("/api/github/repositories", get(github::repositories))
        .route(
            "/api/github/repositories/:owner/:repo/branches",
            get(github::branches),
        )
        .route(
            "/api/github/repositories/:owner/:repo/latest-commit",
            get(github::latest_commit),
        )
        .route_layer(middleware::from_fn_with_state(
            state.config.clone(),
            auth::auth_middleware,
        ));

    let admin_routes = Router::new()
        .route("/api/admin/projects", get(admin_list_projects))
        .route("/api/admin/projects/:id/review", post(admin_review_project).patch(admin_review_project))
        .route("/api/admin/projects/:id", delete(admin_delete_project))
        .route("/api/admin/cluster", get(cluster_status))
        .route_layer(middleware::from_fn(auth::admin_middleware))
        .route_layer(middleware::from_fn_with_state(
            state.config.clone(),
            auth::auth_middleware,
        ));

    let webhook_routes = Router::new()
        .route("/api/webhook/:project_id", post(handle_webhook));

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

fn validate_project_name(name: &str) -> AppResult<()> {
    let mut previous_separator = false;
    let valid_name = name.chars().count() >= 3
        && name.chars().count() <= 50
        && name.chars().next().is_some_and(char::is_alphanumeric)
        && name.chars().all(|c| {
            if c == ' ' || c == '-' {
                if previous_separator { return false; }
                previous_separator = true;
                true
            } else if c.is_alphanumeric() {
                previous_separator = false;
                true
            } else {
                false
            }
        })
        && !previous_separator;
    if !valid_name {
        return Err(AppError::BadRequest("El nombre debe tener entre 3 y 50 caracteres y usar letras, números, espacios o guiones.".into()));
    }
    Ok(())
}

async fn create_project(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateProjectRequest>,
) -> AppResult<(StatusCode, Json<ProjectResponse>)> {
    req.deployment_config.validate().map_err(AppError::BadRequest)?;
    let name = req.name.trim();
    validate_project_name(name)?;
    let base_slug = slugify(name);
    if base_slug.len() < 3 {
        return Err(AppError::BadRequest("El nombre no permite generar una URL válida. Usa letras latinas o números.".into()));
    }
    let purpose = req.purpose.trim();
    if purpose.is_empty() {
        return Err(AppError::BadRequest("Explica el propósito funcional del proyecto.".into()));
    }
    let requested = req.requested_subdomain.trim().to_ascii_lowercase();
    if !requested.is_empty() && !valid_subdomain(&requested) {
        return Err(AppError::BadRequest("La URL debe tener entre 3 y 49 caracteres: letras minúsculas, números y guiones; sin guiones al inicio o al final.".into()));
    }
    let (source_commit, _) = github::validate_project_source(
        &state,
        auth_user.id,
        &req.repo_url,
        &req.branch,
    )
    .await?;
    let repo_name = req.repo_url.trim_end_matches('/').rsplit('/').next().unwrap_or("proyecto");
    let repo_slug = slugify(repo_name);
    for sequence in 1..=1000 {
        let suffix = if sequence == 1 { String::new() } else { format!("-{sequence}") };
        let prefix = base_slug.chars().take(49 - suffix.len()).collect::<String>();
        let slug = format!("{}{}", prefix.trim_end_matches('-'), suffix);
        let subdomain = if requested.is_empty() {
            let prefix = repo_slug.chars().take(42).collect::<String>();
            format!("{}-{}", prefix.trim_end_matches('-'), &Uuid::new_v4().simple().to_string()[..6])
        } else {
            requested.clone()
        };
        if subdomain_taken(&state, &subdomain).await? {
            if !requested.is_empty() {
                return Err(AppError::Conflict("La URL ya existe. Elige otra.".into()));
            }
            continue;
        }
        let project = sqlx::query_as::<_, Project>(
            "INSERT INTO projects (id, user_id, name, slug, repo_url, branch, requested_subdomain, purpose, course, deployment_config, source_commit, status) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, 'pending') ON CONFLICT DO NOTHING \
             RETURNING id, user_id, name, slug, repo_url, branch, status::text AS status, \
             requested_subdomain, purpose, course, review_note, correction_fields, source_commit, adaptation_report, approved_image, domain, webhook_secret, kubero_pipeline, kubero_app, deletion_requested_at, deletion_error, created_at, updated_at",
        )
        .bind(Uuid::new_v4())
        .bind(auth_user.id)
        .bind(name)
        .bind(&slug)
        .bind(&req.repo_url)
        .bind(&req.branch)
        .bind(&subdomain)
        .bind(purpose)
        .bind(req.course.as_deref().filter(|course| !course.trim().is_empty()))
        .bind(serde_json::to_string(&req.deployment_config).map_err(|e| AppError::Internal(e.to_string()))?)
        .bind(&source_commit)
        .fetch_optional(&state.db)
        .await?;
        if let Some(project) = project {
            return Ok((StatusCode::CREATED, Json(project.into())));
        }
        if !requested.is_empty() && subdomain_taken(&state, &subdomain).await? {
            return Err(AppError::Conflict("La URL ya existe. Elige otra.".into()));
        }
    }
    Err(AppError::Conflict("No se pudo reservar una dirección para este proyecto.".into()))
}

fn valid_subdomain(value: &str) -> bool {
    let bytes = value.as_bytes();
    (3..=49).contains(&bytes.len())
        && bytes.first().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && bytes.last().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && bytes.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

async fn subdomain_taken(state: &AppState, name: &str) -> AppResult<bool> {
    Ok(sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE status != 'deleted' \
         AND (requested_subdomain = $1 OR split_part(domain, '.', 1) = $1))",
    )
    .bind(name)
    .fetch_one(&state.db)
    .await?)
}

async fn subdomain_availability(
    State(state): State<AppState>,
    Query(query): Query<SubdomainQuery>,
) -> AppResult<Json<SubdomainAvailability>> {
    let name = query.name.trim().to_ascii_lowercase();
    if !valid_subdomain(&name) {
        return Err(AppError::BadRequest("La URL debe tener entre 3 y 49 caracteres: letras minúsculas, números y guiones.".into()));
    }
    Ok(Json(SubdomainAvailability { available: !subdomain_taken(&state, &name).await? }))
}

async fn get_project_configuration(
    State(state): State<AppState>, Extension(user): Extension<AuthUser>, Path(id): Path<Uuid>,
) -> AppResult<Json<DeploymentConfig>> {
    let (owner, raw) = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT user_id, deployment_config::text FROM projects WHERE id=$1 AND (user_id=$2 OR $3) AND status != 'deleted'",
    ).bind(id).bind(user.id).bind(user.role == "admin").fetch_optional(&state.db).await?.ok_or(AppError::NotFound)?;
    let mut config: DeploymentConfig = serde_json::from_str(&raw).map_err(|e| AppError::Internal(e.to_string()))?;
    if owner != user.id { for value in config.runtime_env.values_mut() { *value = "[oculto]".into(); } }
    Ok(Json(config))
}

async fn save_project_configuration(
    State(state): State<AppState>, Extension(user): Extension<AuthUser>, Path(id): Path<Uuid>,
    Json(config): Json<DeploymentConfig>,
) -> AppResult<StatusCode> {
    config.validate().map_err(AppError::BadRequest)?;
    if !state.config.local_image_deployment {
        return Err(AppError::BadRequest("Esta configuración requiere el ejecutor local de Atlas.".into()));
    }
    let (repo, branch, status, admitted) = sqlx::query_as::<_, (String, String, String, bool)>(
        "SELECT repo_url, branch, status::text, registration_approved_at IS NOT NULL FROM projects \
         WHERE id=$1 AND user_id=$2 AND status IN ('pending','corrections','failed','running')"
    ).bind(id).bind(user.id).fetch_optional(&state.db).await?.ok_or(AppError::NotFound)?;
    let (sha, _) = github::validate_project_source(&state, user.id, &repo, &branch).await?;
    let raw = serde_json::to_string(&config).map_err(|e| AppError::Internal(e.to_string()))?;
    let next_status = if admitted { "approved" } else if status == "corrections" { "corrections" } else { "pending" };
    let result = sqlx::query(
        "UPDATE projects SET source_commit=$4, deployment_config=$1::jsonb, status=$5::project_status, adaptation_claimed_at=NULL, adaptation_report=NULL, approved_image=NULL, updated_at=NOW() \
         WHERE id=$2 AND user_id=$3 AND status IN ('pending','corrections','failed','running')",
    ).bind(raw).bind(id).bind(user.id).bind(sha).bind(next_status).execute(&state.db).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Conflict("No puedes modificar este proyecto mientras espera al ejecutor o se está construyendo.".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn get_runtime_logs(
    State(state): State<AppState>, Extension(user): Extension<AuthUser>, Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<serde_json::Value>>> {
    let (slug, raw) = sqlx::query_as::<_, (String, String)>(
        "SELECT slug, deployment_config::text FROM projects WHERE id=$1 AND (user_id=$2 OR $3) AND status != 'deleted'",
    ).bind(id).bind(user.id).bind(user.role == "admin").fetch_optional(&state.db).await?.ok_or(AppError::NotFound)?;
    let config: DeploymentConfig = serde_json::from_str(&raw).map_err(|e| AppError::Internal(e.to_string()))?;
    let kubero = state.kubero.as_ref().ok_or_else(|| AppError::BadRequest("El clúster no está configurado.".into()))?;
    let namespace = if state.config.local_image_deployment { "atlas-production" } else { &state.config.kubero_namespace };
    let mut entries = kubero.get_runtime_logs(namespace, &slug).await?;
    for entry in &mut entries {
        if let Some(text) = entry.get("logs").and_then(|value| value.as_str()) {
            let mut redacted = text.to_owned();
            for value in config.runtime_env.values() { if !value.is_empty() { redacted = redacted.replace(value, "[oculto]"); } }
            entry["logs"] = json!(redacted);
        }
    }
    Ok(Json(entries))
}

async fn request_project_deletion(state: &AppState, id: Uuid, user: &AuthUser) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    let project = sqlx::query_as::<_, (String,)>(
        "SELECT status::text FROM projects WHERE id=$1 AND (user_id=$2 OR $3)"
    ).bind(id).bind(user.id).bind(user.role == "admin").fetch_optional(&state.db).await?.ok_or(AppError::NotFound)?;
    if project.0 == "deleted" {
        return Ok((StatusCode::OK, Json(json!({"deleted": true}))));
    }
    let result = sqlx::query(
        "UPDATE projects SET deletion_requested_at=COALESCE(deletion_requested_at,NOW()), deletion_error=NULL, updated_at=NOW() \
         WHERE id=$1 AND status NOT IN ('building','deleted')"
    ).bind(id).execute(&state.db).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Conflict("Espera a que termine la construcción antes de eliminar el proyecto.".into()));
    }
    Ok((StatusCode::ACCEPTED, Json(json!({"deleted": false, "message": "Eliminación solicitada. El proyecto seguirá visible hasta verificar el retiro de sus recursos e imágenes."}))))
}

async fn retry_deployment(
    State(state): State<AppState>, Extension(user): Extension<AuthUser>, Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let (repo, branch, owner, admitted) = sqlx::query_as::<_, (String, String, Uuid, bool)>(
        "SELECT repo_url, branch, user_id, registration_approved_at IS NOT NULL FROM projects \
         WHERE id=$1 AND (user_id=$2 OR $3) AND status='failed'"
    ).bind(id).bind(user.id).bind(user.role == "admin").fetch_optional(&state.db).await?.ok_or(AppError::NotFound)?;
    if !admitted {
        return Err(AppError::Conflict("La solicitud necesita aprobación administrativa antes de desplegarse.".into()));
    }
    let (sha, _) = github::validate_project_source(&state, owner, &repo, &branch).await?;
    let result = sqlx::query("UPDATE projects SET status='approved', adaptation_claimed_at=NULL, \
        adaptation_report=CASE WHEN source_commit=$2 THEN adaptation_report ELSE NULL END, \
        approved_image=CASE WHEN source_commit=$2 THEN approved_image ELSE NULL END, source_commit=$2, updated_at=NOW() \
        WHERE id=$1 AND status='failed' AND registration_approved_at IS NOT NULL")
        .bind(id).bind(sha).execute(&state.db).await?;
    if result.rows_affected() == 0 { return Err(AppError::Conflict("El proyecto cambió mientras se solicitaba el despliegue.".into())); }
    Ok(StatusCode::NO_CONTENT)
}

async fn resubmit_project(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(req): Json<ResubmitProjectRequest>,
) -> AppResult<Json<ProjectResponse>> {
    let previous = sqlx::query_as::<_, Project>(
        "SELECT id, user_id, name, slug, repo_url, branch, status::text AS status, requested_subdomain, purpose, course, review_note, correction_fields, source_commit, adaptation_report, approved_image, domain, webhook_secret, kubero_pipeline, kubero_app, deletion_requested_at, deletion_error, created_at, updated_at FROM projects WHERE id=$1 AND user_id=$2 AND status='corrections'"
    ).bind(id).bind(auth_user.id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::Conflict("El proyecto no está pendiente de correcciones.".into()))?;
    req.validate_selection(&previous.correction_fields).map_err(AppError::BadRequest)?;
    let name = req.name.as_deref().unwrap_or(&previous.name).trim();
    validate_project_name(name)?;
    if slugify(name).len() < 3 {
        return Err(AppError::BadRequest("El nombre no permite generar una URL válida. Usa letras latinas o números.".into()));
    }
    let purpose = req.purpose.as_deref().or(previous.purpose.as_deref()).unwrap_or("").trim();
    if purpose.is_empty() {
        return Err(AppError::BadRequest("Explica el propósito funcional del proyecto.".into()));
    }
    let course = req.course.as_deref().or(previous.course.as_deref()).map(str::trim).filter(|value| !value.is_empty());
    if course.is_some_and(|value| value.chars().count() > 255) {
        return Err(AppError::BadRequest("El curso debe tener como máximo 255 caracteres.".into()));
    }
    let repo = req.repo_url.as_deref().unwrap_or(&previous.repo_url).trim();
    let branch = req.branch.as_deref().unwrap_or(&previous.branch).trim();
    if branch.is_empty() {
        return Err(AppError::BadRequest("Selecciona una rama del repositorio.".into()));
    }
    let requested = req.requested_subdomain.as_deref().or(previous.requested_subdomain.as_deref()).unwrap_or("").trim().to_ascii_lowercase();
    let subdomain = if requested.is_empty() {
        let repo_name = repo.trim_end_matches('/').rsplit('/').next().unwrap_or("proyecto");
        let prefix = slugify(repo_name).chars().take(42).collect::<String>();
        format!("{}-{}", prefix.trim_end_matches('-'), &Uuid::new_v4().simple().to_string()[..6])
    } else { requested };
    if !valid_subdomain(&subdomain) {
        return Err(AppError::BadRequest("La URL debe tener entre 3 y 49 caracteres: letras minúsculas, números y guiones; sin guiones al inicio o al final.".into()));
    }
    let taken: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id != $1 AND status != 'deleted' AND (requested_subdomain=$2 OR split_part(domain,'.',1)=$2))"
    ).bind(id).bind(&subdomain).fetch_one(&state.db).await?;
    if taken { return Err(AppError::Conflict("La URL ya existe. Elige otra.".into())); }
    let source_requested = req.repo_url.is_some() || req.branch.is_some();
    let pinned_commit = previous.source_commit.as_deref()
        .filter(|sha| sha.len() == 40 && sha.bytes().all(|byte| byte.is_ascii_hexdigit()));
    let sha = match pinned_commit {
        Some(sha) if !source_requested => sha.to_owned(),
        _ => github::validate_project_source(&state, auth_user.id, repo, branch).await?.0,
    };
    let project = sqlx::query_as::<_, Project>(
        "UPDATE projects SET status='pending', adaptation_claimed_at=NULL, source_commit=$4, \
         adaptation_report=NULL, approved_image=NULL, purpose=$1, name=$5, repo_url=$6, branch=$7, \
         requested_subdomain=$8, course=$9, review_note=NULL, correction_fields='{}', updated_at=NOW() \
         WHERE id = $2 AND user_id = $3 AND status = 'corrections' AND updated_at=$10 \
         RETURNING id, user_id, name, slug, repo_url, branch, status::text AS status, \
         requested_subdomain, purpose, course, review_note, correction_fields, source_commit, adaptation_report, approved_image, domain, webhook_secret, kubero_pipeline, kubero_app, deletion_requested_at, deletion_error, created_at, updated_at",
    )
    .bind(purpose)
    .bind(id)
    .bind(auth_user.id)
    .bind(sha)
    .bind(name)
    .bind(repo)
    .bind(branch)
    .bind(subdomain)
    .bind(course)
    .bind(previous.updated_at)
    .fetch_optional(&state.db)
    .await.map_err(|error| {
        if error.as_database_error().is_some_and(|error| error.is_unique_violation()) {
            AppError::Conflict("La URL ya existe. Elige otra.".into())
        } else { AppError::from(error) }
    })?
    .ok_or_else(|| AppError::Conflict("La solicitud cambió mientras se enviaban las correcciones. Recarga el proyecto.".into()))?;
    Ok(Json(project.into()))
}

async fn admin_review_project(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<ReviewProjectRequest>,
) -> AppResult<Json<ProjectResponse>> {
    let (status, note) = match req.decision.as_str() {
        "approve" => ("approved", None),
        "corrections" => {
            let note = req.note.as_deref().unwrap_or("").trim();
            if note.is_empty() {
                return Err(AppError::BadRequest("Explica las correcciones necesarias.".into()));
            }
            if req.correction_fields.is_empty()
                || req.correction_fields.iter().any(|field| !PROJECT_CORRECTION_FIELDS.contains(&field.as_str()))
                || req.correction_fields.iter().collect::<std::collections::HashSet<_>>().len() != req.correction_fields.len() {
                return Err(AppError::BadRequest("Selecciona uno o varios campos válidos para corregir, sin repetirlos.".into()));
            }
            ("corrections", Some(note))
        }
        _ => return Err(AppError::BadRequest("Decisión no válida.".into())),
    };
    if status == "approved" && !req.correction_fields.is_empty() {
        return Err(AppError::BadRequest("Una aprobación no puede solicitar correcciones.".into()));
    }
    let mut tx = state.db.begin().await?;
    let pending = sqlx::query_as::<_, Project>(
        "SELECT id, user_id, name, slug, repo_url, branch, status::text AS status, \
         requested_subdomain, purpose, course, review_note, correction_fields, source_commit, adaptation_report, approved_image, domain, webhook_secret, kubero_pipeline, kubero_app, deletion_requested_at, deletion_error, created_at, updated_at \
         FROM projects WHERE id = $1 AND status = 'pending' FOR UPDATE",
    ).bind(id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::Conflict("Esta solicitud ya no está pendiente.".into()))?;
    if req.decision == "approve" {
        let pinned = pending.source_commit.as_deref()
            .is_some_and(|sha| sha.len() == 40 && sha.bytes().all(|byte| byte.is_ascii_hexdigit()));
        if !pinned {
            return Err(AppError::Conflict("La solicitud no tiene un commit válido. El desarrollador debe actualizarla y reenviarla.".into()));
        }
    }
    let project = sqlx::query_as::<_, Project>(
        "UPDATE projects SET status=$1::project_status, review_note=$2, correction_fields=$4, \
         registration_approved_at=CASE WHEN $1='approved' THEN COALESCE(registration_approved_at,NOW()) ELSE registration_approved_at END, \
         adaptation_report=NULL, approved_image=NULL, updated_at=NOW() \
         WHERE id = $3 AND status = 'pending' \
         RETURNING id, user_id, name, slug, repo_url, branch, status::text AS status, \
         requested_subdomain, purpose, course, review_note, correction_fields, source_commit, adaptation_report, approved_image, domain, webhook_secret, kubero_pipeline, kubero_app, deletion_requested_at, deletion_error, created_at, updated_at",
    )
    .bind(status)
    .bind(note)
    .bind(id)
    .bind(&req.correction_fields)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Conflict("Esta solicitud ya no está pendiente.".into()))?;
    tx.commit().await?;
    state.event_bus.publish(if req.decision == "approve" { "project.approved" } else { "project.corrections_requested" }, &json!({
        "project_id": project.id, "user_id": project.user_id, "slug": project.slug, "correction_text": note,
        "correction_fields": project.correction_fields,
    })).await;
    Ok(Json(project.into()))
}

async fn list_projects(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<Vec<ProjectResponse>>> {
    let projects = sqlx::query_as::<_, Project>(
        "SELECT id, user_id, name, slug, repo_url, branch, status::text AS status, \
         requested_subdomain, purpose, course, review_note, correction_fields, source_commit, adaptation_report, approved_image, domain, webhook_secret, kubero_pipeline, kubero_app, deletion_requested_at, deletion_error, created_at, updated_at \
         FROM projects WHERE user_id = $1 AND status != 'deleted' ORDER BY created_at DESC",
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
        "SELECT id, user_id, name, slug, repo_url, branch, status::text AS status, \
         requested_subdomain, purpose, course, review_note, correction_fields, source_commit, adaptation_report, approved_image, domain, webhook_secret, kubero_pipeline, kubero_app, deletion_requested_at, deletion_error, created_at, updated_at \
         FROM projects WHERE id = $1 AND (user_id = $2 OR $3) AND status != 'deleted'",
    )
    .bind(id)
    .bind(auth_user.id)
    .bind(auth_user.role == "admin")
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(project.into()))
}

async fn delete_project(
    State(state): State<AppState>, Extension(user): Extension<AuthUser>, Path(id): Path<Uuid>,
) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    request_project_deletion(&state, id, &user).await
}

async fn list_builds(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(project_id): Path<Uuid>,
) -> AppResult<Json<Vec<BuildResponse>>> {
    let builds = sqlx::query_as::<_, Build>(
        "SELECT b.id, b.project_id, b.status::text AS status, b.logs, b.commit_sha, \
         b.commit_message, b.started_at, b.completed_at, b.created_at \
         FROM builds b \
         JOIN projects p ON p.id = b.project_id \
         WHERE b.project_id = $1 AND (p.user_id = $2 OR $3) \
         ORDER BY b.created_at DESC LIMIT 50",
    )
    .bind(project_id)
    .bind(auth_user.id)
    .bind(auth_user.role == "admin")
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
        "SELECT id, user_id, name, slug, repo_url, branch, status::text AS status, \
         domain, webhook_secret, kubero_pipeline, kubero_app, deletion_requested_at, deletion_error, created_at, updated_at \
         FROM projects WHERE id = $1 AND user_id = $2 AND status != 'deleted'",
    )
    .bind(id)
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    if ["pending", "corrections", "approved", "adapting"].contains(&project.status.as_str()) {
        return Err(AppError::NotFound);
    }
    let secret = project.webhook_secret.ok_or(AppError::NotFound)?;

    Ok(Json(json!({
        "webhook_url": format!("/api/webhook/{}", project.id),
        "webhook_secret": secret,
    })))
}

async fn get_deployment_status(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let project = sqlx::query_as::<_, Project>(
        "SELECT id, user_id, name, slug, repo_url, branch, status::text AS status, \
         domain, webhook_secret, kubero_pipeline, kubero_app, deletion_requested_at, deletion_error, created_at, updated_at \
         FROM projects WHERE id = $1 AND (user_id = $2 OR $3) AND status != 'deleted'",
    )
    .bind(id)
    .bind(auth_user.id)
    .bind(auth_user.role == "admin")
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    if let Some(kubero) = &state.kubero {
        if let Some(app_name) = &project.kubero_app {
            let namespace = &state.config.kubero_namespace;
            let status = kubero.get_app_status(namespace, app_name).await?;
            
            // Get pod events for this app
            let events = kubero.get_app_events(namespace, app_name).await.unwrap_or_default();
            
            return Ok(Json(json!({
                "project_id": project.id,
                "project_name": project.name,
                "slug": project.slug,
                "domain": project.domain,
                "cluster_configured": true,
                "kubero_status": status,
                "events": events,
            })));
        }
    }

    // Fallback if Kubernetes is not configured or app doesn't exist yet
    Ok(Json(json!({
        "project_id": project.id,
        "project_name": project.name,
        "slug": project.slug,
        "domain": null,
        "cluster_configured": state.kubero.is_some(),
        "kubero_status": null,
        "events": [],
        "message": if state.kubero.is_some() { "Kubero application not yet created" } else { "Kubernetes is not configured" },
    })))
}

async fn handle_webhook(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    headers: axum::http::HeaderMap,
    body: String,
) -> AppResult<StatusCode> {
    let project = sqlx::query_as::<_, Project>(
        "SELECT id, user_id, name, slug, repo_url, branch, status::text AS status, \
         domain, webhook_secret, kubero_pipeline, kubero_app, deletion_requested_at, deletion_error, created_at, updated_at \
         FROM projects WHERE id = $1 AND status != 'deleted'",
    )
    .bind(project_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    if project.webhook_secret.is_none() || ["pending", "corrections", "approved", "adapting"].contains(&project.status.as_str()) {
        return Err(AppError::Forbidden);
    }

    let _signature = headers
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
        "SELECT id, user_id, name, slug, repo_url, branch, status::text AS status, \
         requested_subdomain, purpose, course, review_note, correction_fields, source_commit, adaptation_report, approved_image, domain, webhook_secret, kubero_pipeline, kubero_app, deletion_requested_at, deletion_error, created_at, updated_at \
         FROM projects WHERE status != 'deleted' ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(projects.into_iter().map(|p| p.into()).collect()))
}

async fn admin_delete_project(
    State(state): State<AppState>, Extension(user): Extension<AuthUser>, Path(id): Path<Uuid>,
) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    request_project_deletion(&state, id, &user).await
}

async fn cluster_status(State(state): State<AppState>) -> AppResult<Json<ClusterStatus>> {
    let kubero = state.kubero.as_ref().ok_or_else(|| {
        AppError::Internal("Kubernetes is not configured for this environment".into())
    })?;
    let status = kubero.get_cluster_status().await?;
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
    let mut slug = String::new();
    for c in name.nfd() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
        } else if is_combining_mark(c) {
            continue;
        } else if (c == ' ' || c == '-') && !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    slug.trim_end_matches('-').to_string()
}
