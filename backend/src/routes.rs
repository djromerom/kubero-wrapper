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
    github, ci,
    models::*,
    ws::WsManager,
};

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: sqlx::PgPool,
    pub event_bus: EventBus,
    pub ci_clients: Option<crate::ci_clients::CiClients>,
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
        .route("/api/projects/:id/ci/runs", get(ci::list))
        .route("/api/projects/:id/ci/retry", post(ci::retry))
        .route("/api/projects/:id/deployment/retry", post(cd_unavailable))
        .route("/api/projects/:id/configuration", get(get_project_configuration).put(save_project_configuration))
        .route("/api/projects/:id/runtime-logs", get(cd_unavailable))
        .route("/api/projects/:id/builds", get(list_builds))
        .route("/api/projects/:id/webhook", get(cd_unavailable))
        .route("/api/projects/:id/deployment-status", get(cd_unavailable))
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
        .route("/api/admin/projects/:id", delete(admin_delete_project))
        .route("/api/admin/cluster", get(cd_unavailable))
        .route_layer(middleware::from_fn(auth::admin_middleware))
        .route_layer(middleware::from_fn_with_state(
            state.config.clone(),
            auth::auth_middleware,
        ));

    let webhook_routes = Router::new()
        .route("/api/webhook/:project_id", post(cd_unavailable))
        .route("/api/internal/ci/runs/:id/authorization", get(ci::authorization));

    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .merge(admin_routes)
        .merge(webhook_routes)
        .with_state(state)
}

async fn cd_unavailable() -> AppResult<StatusCode> {
    Err(AppError::ServiceUnavailable("El despliegue con Kubero no está habilitado en esta fase de CI.".into()))
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
    Json(mut req): Json<CreateProjectRequest>,
) -> AppResult<(StatusCode, Json<ProjectResponse>)> {
    req.repo_url = github::canonical_repository_url(&req.repo_url)?;
    let request_hash = crate::ci_clients::digest(&serde_json::to_vec(&req).map_err(|_| AppError::BadRequest("Registro no válido".into()))?);
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
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("{}:{}",auth_user.id,req.request_id)).execute(&mut *tx).await?;
    if let Some((id, saved_hash)) = sqlx::query_as::<_, (Uuid, String)>("SELECT id,registration_hash FROM projects WHERE user_id=$1 AND registration_key=$2")
        .bind(auth_user.id).bind(req.request_id).fetch_optional(&mut *tx).await? {
        if saved_hash != request_hash { return Err(AppError::Conflict("El identificador de registro ya se usó con otros datos.".into())); }
        tx.commit().await?;
        let Json(project) = get_project(State(state), Extension(auth_user), Path(id)).await?;
        return Ok((StatusCode::OK, Json(project)));
    }
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
            "INSERT INTO projects (id, user_id, name, slug, repo_url, branch, requested_subdomain, purpose, course, deployment_config, source_commit, status, ci_managed, registration_key, registration_hash) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, 'pending', TRUE, $12, $13) ON CONFLICT DO NOTHING \
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
        .bind(req.request_id)
        .bind(&request_hash)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(project) = project {
            ci::enqueue(&mut tx, &state.config.ci, project.id, &project.repo_url, &project.branch, &source_commit).await?;
            tx.commit().await?;
            return Ok((StatusCode::CREATED, Json(ci::response(&state, project).await?)));
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
    let raw = serde_json::to_value(&config).map_err(|_| AppError::BadRequest("Configuración no válida".into()))?;
    let result = sqlx::query("UPDATE projects SET deployment_config=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3 AND status!='deleted' AND deletion_requested_at IS NULL")
        .bind(raw).bind(id).bind(user.id).execute(&state.db).await?;
    if result.rows_affected() == 0 { return Err(AppError::NotFound); }
    Ok(StatusCode::NO_CONTENT)
}

async fn request_project_deletion(state: &AppState, id: Uuid, user: &AuthUser) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    let mut tx = state.db.begin().await?;
    let (status, managed, app, domain) = sqlx::query_as::<_, (String, bool, Option<String>, Option<String>)>(
        "SELECT status::text,ci_managed,kubero_app,domain FROM projects WHERE id=$1 AND (user_id=$2 OR $3) FOR UPDATE")
        .bind(id).bind(user.id).bind(user.role == "admin").fetch_optional(&mut *tx).await?.ok_or(AppError::NotFound)?;
    if status == "deleted" { return Ok((StatusCode::OK, Json(json!({"deleted":true})))); }
    if !managed || app.is_some() || domain.is_some() || status == "running" || status == "building" {
        return Err(AppError::Conflict("El proyecto conserva recursos históricos. Su retirada requiere la integración de CD; no se ha eliminado ningún recurso.".into()));
    }
    // Lock runs as well: an in-flight dispatcher must not race an archive request.
    let active: Vec<(Uuid,String)> = sqlx::query_as("SELECT id,status FROM ci_runs WHERE project_id=$1 AND completed_at IS NULL FOR UPDATE")
        .bind(id).fetch_all(&mut *tx).await?;
    if active.iter().any(|(_,status)| !["queued","blocked"].contains(&status.as_str())) {
        return Err(AppError::Conflict("Espera a que termine o se concilie la ejecución de CI antes de archivar.".into()));
    }
    sqlx::query("UPDATE ci_runs SET status='cancelled',completed_at=NOW(),updated_at=NOW(),lease_id=NULL,lease_until=NULL WHERE project_id=$1 AND completed_at IS NULL")
        .bind(id).execute(&mut *tx).await?;
    sqlx::query("UPDATE projects SET status='deleted',updated_at=NOW() WHERE id=$1")
        .bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((StatusCode::OK, Json(json!({"deleted":true,"message":"Proyecto archivado. Se conservan el historial y las imágenes; no se eliminaron recursos externos."}))))
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
    let mut tx = state.db.begin().await?;
    let project = sqlx::query_as::<_, Project>(
        "UPDATE projects SET status='pending', ci_managed=TRUE, adaptation_claimed_at=NULL, source_commit=$4, \
         adaptation_report=NULL, approved_image=NULL, purpose=$1, name=$5, repo_url=$6, branch=$7, \
         requested_subdomain=$8, course=$9, review_note=NULL, correction_fields='{}', updated_at=NOW() \
         WHERE id = $2 AND user_id = $3 AND deletion_requested_at IS NULL AND status = 'corrections' AND updated_at=$10 \
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
    .fetch_optional(&mut *tx)
    .await.map_err(|error| {
        if error.as_database_error().is_some_and(|error| error.is_unique_violation()) {
            AppError::Conflict("La URL ya existe. Elige otra.".into())
        } else { AppError::from(error) }
    })?
    .ok_or_else(|| AppError::Conflict("La solicitud cambió mientras se enviaban las correcciones. Recarga el proyecto.".into()))?;
    ci::enqueue(&mut tx, &state.config.ci, project.id, &project.repo_url, &project.branch, project.source_commit.as_deref().unwrap_or("")).await?;
    tx.commit().await?;
    Ok(Json(ci::response(&state, project).await?))
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

    let mut results = Vec::with_capacity(projects.len());
    for project in projects { results.push(ci::response(&state, project).await?); }
    Ok(Json(results))
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

    Ok(Json(ci::response(&state, project).await?))
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

    let mut results = Vec::with_capacity(projects.len());
    for project in projects { results.push(ci::response(&state, project).await?); }
    Ok(Json(results))
}

async fn admin_delete_project(
    State(state): State<AppState>, Extension(user): Extension<AuthUser>, Path(id): Path<Uuid>,
) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    request_project_deletion(&state, id, &user).await
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
