use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
    http::StatusCode,
    middleware,
    response::{IntoResponse, Redirect},
    routing::{delete, get, post},
    Extension, Json, Router,
};
use chrono::Utc;
use jsonwebtoken::{
    decode, encode, DecodingKey, EncodingKey, Header, Validation,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    auth::{self, AuthUser},
    config::Config,
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

/* ============================================================
   ROUTER
   ============================================================ */

pub fn create_router(state: AppState) -> Router {
    let public_routes = Router::new()
        .route("/health", get(health_check))
        .route("/auth/register", post(register))
        .route("/auth/login", post(login));

    let protected_routes = Router::new()
        .route("/projects", get(list_projects).post(create_project))
        .route("/projects/:id", get(get_project).delete(delete_project))
        .route("/projects/:id/builds", get(list_builds))
        .route("/projects/:id/webhook", get(get_webhook))
        .route("/ws", get(ws_handler))
        .route_layer(middleware::from_fn_with_state(
            state.config.clone(),
            auth::auth_middleware,
        ));

    /*
     * GitHub:
     *
     * /connect, /repositories, /branches y /latest-commit
     * requieren autenticación de Atlas.
     *
     * /callback NO puede llevar auth_middleware porque GitHub
     * redirige directamente al navegador y no conoce nuestro
     * JWT de Atlas.
     */
    let github_routes = Router::new()

        .route("/api/github/connect", get(github_connect))

        .route("/api/github/repositories", get(github_repositories))

        .route(
            "/api/github/repositories/:owner/:repo/branches",
            get(github_branches),
        )

        .route(
            "/api/github/repositories/:owner/:repo/latest-commit",
            get(github_latest_commit),
        )

        .route_layer(middleware::from_fn_with_state(
            state.config.clone(),
            auth::auth_middleware,
        ));
    /*
     * Callback público de GitHub.
     */
    let github_callback_route =
        Router::new().route("/api/github/callback", get(github_callback));

    let admin_routes = Router::new()
        .route("/admin/projects", get(admin_list_projects))
        .route("/admin/projects/{id}", delete(admin_delete_project))
        .route("/admin/cluster", get(cluster_status))
        .route_layer(middleware::from_fn_with_state(
            state.config.clone(),
            auth::auth_middleware,
        ))
        .route_layer(middleware::from_fn(auth::admin_middleware));

    let webhook_routes =
        Router::new().route("/webhook/:project_id", post(handle_webhook));

    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .merge(github_routes)
        .merge(github_callback_route)
        .merge(admin_routes)
        .merge(webhook_routes)
        .with_state(state)
}

/* ============================================================
   HEALTH
   ============================================================ */

async fn health_check(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
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

/* ============================================================
   AUTH
   ============================================================ */

async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> AppResult<(StatusCode, Json<AuthResponse>)> {
    let existing =
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE email = $1",
        )
        .bind(&req.email)
        .fetch_one(&state.db)
        .await?;

    if existing > 0 {
        return Err(AppError::Conflict(
            "Email already registered".into(),
        ));
    }

    let password_hash = auth::hash_password(&req.password)?;

    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (email, password_hash, name)
         VALUES ($1, $2, $3)
         RETURNING *",
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
    let user = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE email = $1",
    )
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

/* ============================================================
   GITHUB APP
   ============================================================ */

/*
 * State firmado que utilizamos para conectar el callback de
 * GitHub con el usuario de Atlas que inició la operación.
 *
 * No utilizamos el JWT normal del usuario porque GitHub no lo
 * devuelve al callback.
 */
#[derive(Debug, Serialize, Deserialize)]
struct GitHubStateClaims {
    sub: String,
    purpose: String,
    iat: usize,
    exp: usize,
}

/*
 * Query que GitHub devuelve al callback.
 */
#[derive(Debug, Deserialize)]
struct GitHubCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    installation_id: Option<i64>,
    setup_action: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/*
 * Inicia la instalación/autorización de nuestra GitHub App.
 */
async fn github_connect(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Redirect> {
    if state.config.github_app_slug.is_empty()
        || state.config.github_client_id.is_empty()
        || state.config.github_app_id.is_empty()
    {
        return Err(AppError::Internal(
            "GitHub App is not configured yet".into(),
        ));
    }

    let now = Utc::now();

    /*
     * El state dura 10 minutos.
     */
    let claims = GitHubStateClaims {
        sub: auth_user.id.to_string(),
        purpose: "github_connect".to_string(),
        iat: now.timestamp() as usize,
        exp: (now + chrono::Duration::minutes(10)).timestamp()
            as usize,
    };

    let state_token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(
            state.config.jwt_secret.as_bytes(),
        ),
    )?;

    /*
     * Como el JWT utiliza Base64URL, podemos colocarlo
     * directamente como query parameter.
     */
    let url = format!(
        "https://github.com/apps/{}/installations/new?state={}",
        state.config.github_app_slug,
        state_token
    );

    Ok(Redirect::to(&url))
}

/*
 * Callback público de GitHub.
 *
 * Aquí:
 * 1. Validamos state.
 * 2. Intercambiamos code por access token.
 * 3. Obtenemos usuario GitHub.
 * 4. Verificamos que la instalación pertenece a nuestra App.
 * 5. Guardamos la cuenta GitHub asociada al usuario Atlas.
 */
async fn github_callback(
    State(state): State<AppState>,
    Query(query): Query<GitHubCallbackQuery>,
) -> AppResult<Json<serde_json::Value>> {
    if let Some(error) = query.error {
        return Err(AppError::BadRequest(
            query
                .error_description
                .unwrap_or(error),
        ));
    }

    let code = query
        .code
        .ok_or_else(|| {
            AppError::BadRequest(
                "Missing GitHub authorization code".into(),
            )
        })?;

    let state_token = query
        .state
        .ok_or_else(|| {
            AppError::BadRequest(
                "Missing GitHub state parameter".into(),
            )
        })?;

    let installation_id = query
        .installation_id
        .ok_or_else(|| {
            AppError::BadRequest(
                "Missing GitHub installation id".into(),
            )
        })?;

    if state.config.github_client_id.is_empty()
        || state.config.github_client_secret.is_empty()
        || state.config.github_app_id.is_empty()
    {
        return Err(AppError::Internal(
            "GitHub App is not configured yet".into(),
        ));
    }

    /*
     * Validamos el state.
     */
    let token_data = decode::<GitHubStateClaims>(
        &state_token,
        &DecodingKey::from_secret(
            state.config.jwt_secret.as_bytes(),
        ),
        &Validation::default(),
    )?;

    if token_data.claims.purpose != "github_connect" {
        return Err(AppError::BadRequest(
            "Invalid GitHub state".into(),
        ));
    }

    let atlas_user_id =
        Uuid::parse_str(&token_data.claims.sub)
            .map_err(|_| {
                AppError::BadRequest(
                    "Invalid Atlas user in GitHub state".into(),
                )
            })?;

    let client = reqwest::Client::new();

    /*
     * Intercambiamos el code por el token de usuario GitHub.
     */
    let token_response = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&json!({
            "client_id": state.config.github_client_id,
            "client_secret": state.config.github_client_secret,
            "code": code,
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if !token_response.status().is_success() {
        return Err(AppError::BadRequest(
            "GitHub authorization failed".into(),
        ));
    }

    let token_data: serde_json::Value = token_response
        .json()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if let Some(error) = token_data.get("error") {
        return Err(AppError::BadRequest(
            error
                .as_str()
                .unwrap_or("GitHub authorization failed")
                .to_string(),
        ));
    }

    let access_token = token_data
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            AppError::Internal(
                "GitHub did not return an access token".into(),
            )
        })?;

    /*
     * Obtenemos el usuario GitHub.
     */
    let github_user_response = client
        .get("https://api.github.com/user")
        .bearer_auth(access_token)
        .header("User-Agent", "Atlas-Kubero-Wrapper")
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if !github_user_response.status().is_success() {
        return Err(AppError::BadRequest(
            "Unable to retrieve GitHub user".into(),
        ));
    }

    let github_user: serde_json::Value = github_user_response
        .json()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let github_user_id = github_user
        .get("id")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| {
            AppError::Internal(
                "GitHub user ID not found".into(),
            )
        })?;

    let github_login = github_user
        .get("login")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            AppError::Internal(
                "GitHub login not found".into(),
            )
        })?;

    /*
     * Verificamos que la instalación indicada por GitHub:
     *
     * - pertenece al usuario autenticado
     * - pertenece a nuestra GitHub App
     */
    let installations_response = client
        .get("https://api.github.com/user/installations")
        .bearer_auth(access_token)
        .header("User-Agent", "Atlas-Kubero-Wrapper")
        .query(&[("per_page", "100")])
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if !installations_response.status().is_success() {
        return Err(AppError::BadRequest(
            "Unable to verify GitHub App installation".into(),
        ));
    }

    let installations_data: serde_json::Value =
        installations_response
            .json()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

    let configured_app_id: i64 = state
        .config
        .github_app_id
        .parse()
        .map_err(|_| {
            AppError::Internal(
                "GITHUB_APP_ID must be a valid number".into(),
            )
        })?;

    let installation_is_valid = installations_data
        .get("installations")
        .and_then(|v| v.as_array())
        .map(|installations| {
            installations.iter().any(|installation| {
                installation
                    .get("id")
                    .and_then(|v| v.as_i64())
                    == Some(installation_id)
                    && installation
                        .get("app_id")
                        .and_then(|v| v.as_i64())
                        == Some(configured_app_id)
            })
        })
        .unwrap_or(false);

    if !installation_is_valid {
        return Err(AppError::Forbidden);
    }

    /*
     * Guardamos la cuenta GitHub vinculada al usuario Atlas.
     */
    sqlx::query(
        "INSERT INTO github_accounts
            (user_id, github_user_id, github_login, access_token)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id)
         DO UPDATE SET
            github_user_id = EXCLUDED.github_user_id,
            github_login = EXCLUDED.github_login,
            access_token = EXCLUDED.access_token,
            updated_at = NOW()",
    )
    .bind(atlas_user_id)
    .bind(github_user_id)
    .bind(github_login)
    .bind(access_token)
    .execute(&state.db)
    .await?;

    /*
     * También mantenemos github_id en users.
     */
    sqlx::query(
        "UPDATE users
         SET github_id = $1,
             updated_at = NOW()
         WHERE id = $2",
    )
    .bind(github_user_id.to_string())
    .bind(atlas_user_id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "message": "GitHub account linked successfully",
        "github_user_id": github_user_id,
        "github_login": github_login,
        "installation_id": installation_id,
        "setup_action": query.setup_action,
    })))
}

/*
 * Obtiene la cuenta GitHub vinculada a un usuario Atlas.
 */
async fn get_github_account(
    state: &AppState,
    user_id: Uuid,
) -> AppResult<GitHubAccount> {
    sqlx::query_as::<_, GitHubAccount>(
        "SELECT * FROM github_accounts WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| {
        AppError::BadRequest(
            "GitHub account is not linked".into(),
        )
    })
}

/*
 * Devuelve las instalaciones de nuestra GitHub App
 * disponibles para el usuario.
 */
async fn get_github_installations(
    state: &AppState,
    account: &GitHubAccount,
) -> AppResult<Vec<i64>> {
    let client = reqwest::Client::new();

    let response = client
        .get("https://api.github.com/user/installations")
        .bearer_auth(&account.access_token)
        .header("User-Agent", "Atlas-Kubero-Wrapper")
        .query(&[("per_page", "100")])
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err(AppError::Forbidden);
    }

    if !response.status().is_success() {
        return Err(AppError::BadRequest(
            "Unable to retrieve GitHub App installations"
                .into(),
        ));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let configured_app_id: i64 = state
        .config
        .github_app_id
        .parse()
        .map_err(|_| {
            AppError::Internal(
                "GITHUB_APP_ID must be a valid number".into(),
            )
        })?;

    let installations = data
        .get("installations")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|installation| {
                    let app_id = installation
                        .get("app_id")
                        .and_then(|v| v.as_i64());

                    let id = installation
                        .get("id")
                        .and_then(|v| v.as_i64());

                    if app_id == Some(configured_app_id) {
                        id
                    } else {
                        None
                    }
                })
                .collect::<Vec<i64>>()
        })
        .unwrap_or_default();

    Ok(installations)
}

/*
 * Comprueba que un repositorio está dentro de una instalación
 * de nuestra GitHub App.
 *
 * Esto evita que alguien escriba manualmente una URL privada
 * y obtenga acceso solamente por conocer owner/repo.
 */
async fn verify_github_repository_access(
    state: &AppState,
    account: &GitHubAccount,
    owner: &str,
    repo: &str,
) -> AppResult<()> {
    let installations =
        get_github_installations(state, account).await?;

    if installations.is_empty() {
        return Err(AppError::Forbidden);
    }

    let expected_name =
        format!("{}/{}", owner, repo).to_lowercase();

    let client = reqwest::Client::new();

    for installation_id in installations {
        let response = client
            .get(format!(
                "https://api.github.com/user/installations/{}/repositories",
                installation_id
            ))
            .bearer_auth(&account.access_token)
            .header("User-Agent", "Atlas-Kubero-Wrapper")
            .query(&[("per_page", "100")])
            .send()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if !response.status().is_success() {
            continue;
        }

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let found = data
            .get("repositories")
            .and_then(|v| v.as_array())
            .map(|repositories| {
                repositories.iter().any(|repository| {
                    repository
                        .get("full_name")
                        .and_then(|v| v.as_str())
                        .map(|name| {
                            name.to_lowercase() == expected_name
                        })
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);

        if found {
            return Ok(());
        }
    }

    Err(AppError::Forbidden)
}

/*
 * Lista únicamente los repositorios disponibles mediante
 * la instalación de nuestra GitHub App.
 */
async fn github_repositories(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<serde_json::Value>> {
    let account =
        get_github_account(&state, auth_user.id).await?;

    let installations =
        get_github_installations(&state, &account).await?;

    if installations.is_empty() {
        return Err(AppError::BadRequest(
            "GitHub App is not installed for this account"
                .into(),
        ));
    }

    let client = reqwest::Client::new();

    /*
     * HashMap para no repetir repositorios si existen varias
     * instalaciones.
     */
    let mut repositories: HashMap<i64, serde_json::Value> =
        HashMap::new();

    for installation_id in installations {
        let response = client
            .get(format!(
                "https://api.github.com/user/installations/{}/repositories",
                installation_id
            ))
            .bearer_auth(&account.access_token)
            .header("User-Agent", "Atlas-Kubero-Wrapper")
            .query(&[("per_page", "100")])
            .send()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if !response.status().is_success() {
            continue;
        }

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if let Some(items) =
            data.get("repositories").and_then(|v| v.as_array())
        {
            for repository in items {
                if let Some(id) =
                    repository.get("id").and_then(|v| v.as_i64())
                {
                    repositories.insert(id, repository.clone());
                }
            }
        }
    }

    let repositories = repositories
        .into_values()
        .collect::<Vec<serde_json::Value>>();

    Ok(Json(json!({
        "repositories": repositories
    })))
}

/*
 * Obtiene las ramas del repositorio seleccionado.
 */
async fn github_branches(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path((owner, repo)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    let account =
        get_github_account(&state, auth_user.id).await?;

    /*
     * IMPORTANTE:
     * verificamos que el repo pertenece a una instalación
     * autorizada antes de consultar sus ramas.
     */
    verify_github_repository_access(
        &state,
        &account,
        &owner,
        &repo,
    )
    .await?;

    let url = format!(
        "https://api.github.com/repos/{}/{}/branches",
        owner, repo
    );

    let client = reqwest::Client::new();

    let response = client
        .get(url)
        .bearer_auth(&account.access_token)
        .header("User-Agent", "Atlas-Kubero-Wrapper")
        .query(&[("per_page", "100")])
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err(AppError::Forbidden);
    }

    if !response.status().is_success() {
        return Err(AppError::BadRequest(
            "Unable to retrieve GitHub branches".into(),
        ));
    }

    let branches: serde_json::Value = response
        .json()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(json!({
        "owner": owner,
        "repository": repo,
        "branches": branches
    })))
}

/*
 * Query para obtener el último commit de una rama.
 */
#[derive(Debug, Deserialize)]
struct LatestCommitQuery {
    branch: String,
}

/*
 * Obtiene automáticamente el commit más reciente de la rama.
 *
 * El usuario NO puede seleccionar manualmente un SHA.
 */
async fn github_latest_commit(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path((owner, repo)): Path<(String, String)>,
    Query(query): Query<LatestCommitQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let account =
        get_github_account(&state, auth_user.id).await?;

    verify_github_repository_access(
        &state,
        &account,
        &owner,
        &repo,
    )
    .await?;

    if query.branch.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Branch cannot be empty".into(),
        ));
    }

    let url = format!(
        "https://api.github.com/repos/{}/{}/commits",
        owner, repo
    );

    let client = reqwest::Client::new();

    let response = client
        .get(url)
        .bearer_auth(&account.access_token)
        .header("User-Agent", "Atlas-Kubero-Wrapper")
        .query(&[
            ("sha", query.branch.as_str()),
            ("per_page", "1"),
        ])
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err(AppError::Forbidden);
    }

    if !response.status().is_success() {
        return Err(AppError::BadRequest(
            "Unable to retrieve latest GitHub commit".into(),
        ));
    }

    let commits: serde_json::Value = response
        .json()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let latest_commit = commits
        .as_array()
        .and_then(|items| items.first())
        .cloned()
        .ok_or(AppError::NotFound)?;

    Ok(Json(json!({
        "owner": owner,
        "repository": repo,
        "branch": query.branch,
        "commit": latest_commit
    })))
}

/* ============================================================
   PROJECTS
   ============================================================ */

/*
 * Extrae owner/repository de una URL de GitHub.
 *
 * Ejemplo:
 * https://github.com/usuario/proyecto
 *
 * devuelve:
 * owner = usuario
 * repo  = proyecto
 */
fn parse_github_repo_url(
    repo_url: &str,
) -> AppResult<(String, String)> {
    let url = repo_url.trim();

    let prefix = "https://github.com/";

    if !url.starts_with(prefix) {
        return Err(AppError::BadRequest(
            "Repository must be a valid GitHub HTTPS URL".into(),
        ));
    }

    let path = url
        .strip_prefix(prefix)
        .unwrap_or("")
        .trim_end_matches('/');

    let mut parts = path.split('/');

    let owner = parts.next().unwrap_or("").trim();
    let repo = parts.next().unwrap_or("").trim();

    if owner.is_empty()
        || repo.is_empty()
        || parts.next().is_some()
    {
        return Err(AppError::BadRequest(
            "Invalid GitHub repository URL. Expected https://github.com/owner/repository"
                .into(),
        ));
    }

    let repo = repo.strip_suffix(".git").unwrap_or(repo);

    if repo.is_empty() {
        return Err(AppError::BadRequest(
            "Invalid GitHub repository name".into(),
        ));
    }

    Ok((owner.to_string(), repo.to_string()))
}

/*
 * Crea un proyecto.
 *
 * Antes de insertar el proyecto verificamos:
 *
 * 1. El usuario tiene una cuenta GitHub vinculada.
 * 2. El repositorio pertenece a una instalación autorizada
 *    de nuestra GitHub App.
 * 3. La rama seleccionada existe.
 * 4. Se puede obtener el commit más reciente.
 *
 * De esta manera, escribir manualmente una URL de un repositorio
 * privado NO otorga acceso si el repositorio no está autorizado.
 */
async fn create_project(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateProjectRequest>,
) -> AppResult<(StatusCode, Json<ProjectResponse>)> {
    /*
     * Validamos el nombre.
     */
    if req.name.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Project name cannot be empty".into(),
        ));
    }

    /*
     * Validamos la rama.
     */
    if req.branch.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Branch cannot be empty".into(),
        ));
    }

    /*
     * Obtenemos la cuenta GitHub vinculada al usuario Atlas.
     */
    let account =
        get_github_account(&state, auth_user.id).await?;

    /*
     * Extraemos owner y repository de la URL.
     *
     * Ejemplo:
     * https://github.com/djromerom/kubero-wrapper
     *
     * owner = djromerom
     * repo  = kubero-wrapper
     */
    let (owner, repo) =
        parse_github_repo_url(&req.repo_url)?;

    /*
     * Verificamos que el repositorio esté autorizado
     * por nuestra GitHub App.
     *
     * Esto es lo que impide que un usuario simplemente escriba
     * la URL de cualquier repositorio privado.
     */
    verify_github_repository_access(
        &state,
        &account,
        &owner,
        &repo,
    )
    .await?;

    let client = reqwest::Client::new();

    /*
     * Comprobamos que la rama seleccionada exista.
     */
    let branches_url = format!(
        "https://api.github.com/repos/{}/{}/branches",
        owner, repo
    );

    let branches_response = client
        .get(branches_url)
        .bearer_auth(&account.access_token)
        .header("User-Agent", "Atlas-Kubero-Wrapper")
        .query(&[("per_page", "100")])
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if branches_response.status() == StatusCode::UNAUTHORIZED {
        return Err(AppError::Forbidden);
    }

    if !branches_response.status().is_success() {
        return Err(AppError::BadRequest(
            "Unable to verify GitHub branch".into(),
        ));
    }

    let branches: serde_json::Value = branches_response
        .json()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let branch_exists = branches
        .as_array()
        .map(|items| {
            items.iter().any(|branch| {
                branch
                    .get("name")
                    .and_then(|value| value.as_str())
                    == Some(req.branch.as_str())
            })
        })
        .unwrap_or(false);

    if !branch_exists {
        return Err(AppError::BadRequest(
            "Selected branch does not exist in the repository"
                .into(),
        ));
    }

    /*
     * Obtenemos automáticamente el commit más reciente
     * de la rama seleccionada.
     *
     * El usuario NO selecciona manualmente el commit.
     */
    let commits_url = format!(
        "https://api.github.com/repos/{}/{}/commits",
        owner, repo
    );

    let commits_response = client
        .get(commits_url)
        .bearer_auth(&account.access_token)
        .header("User-Agent", "Atlas-Kubero-Wrapper")
        .query(&[
            ("sha", req.branch.as_str()),
            ("per_page", "1"),
        ])
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if commits_response.status() == StatusCode::UNAUTHORIZED {
        return Err(AppError::Forbidden);
    }

    if !commits_response.status().is_success() {
        return Err(AppError::BadRequest(
            "Unable to retrieve latest GitHub commit".into(),
        ));
    }

    let commits: serde_json::Value = commits_response
        .json()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let latest_commit = commits
        .as_array()
        .and_then(|items| items.first())
        .ok_or(AppError::NotFound)?;

    let commit_sha = latest_commit
        .get("sha")
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            AppError::Internal(
                "GitHub latest commit SHA not found".into(),
            )
        })?;

    let commit_message = latest_commit
        .get("commit")
        .and_then(|value| value.get("message"))
        .and_then(|value| value.as_str())
        .unwrap_or("");

    /*
     * Generamos los datos del proyecto.
     */
    let slug = slugify(&req.name);

    let webhook_secret =
        uuid::Uuid::new_v4().to_string();

    let domain =
        format!("{}.{}", slug, state.config.domain_suffix);

    /*
     * Insertamos el proyecto solamente después de haber
     * verificado GitHub, el repositorio, la rama y el commit.
     */
    let project = sqlx::query_as::<_, Project>(
        "INSERT INTO projects
            (user_id, name, slug, repo_url, branch, domain, webhook_secret)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *",
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

    /*
     * Publicamos el evento incluyendo el commit más reciente
     * que GitHub devolvió automáticamente.
     */
    state
        .event_bus
        .publish(
            "project.created",
            &json!({
                "project_id": project.id,
                "user_id": project.user_id,
                "slug": project.slug,
                "repo_url": project.repo_url,
                "branch": project.branch,
                "domain": project.domain,
                "commit_sha": commit_sha,
                "commit_message": commit_message,
            }),
        )
        .await;

    Ok((StatusCode::CREATED, Json(project.into())))
}

async fn list_projects(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<Vec<ProjectResponse>>> {
    let projects = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects
         WHERE user_id = $1 AND status != 'deleted'
         ORDER BY created_at DESC",
    )
    .bind(auth_user.id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(
        projects.into_iter().map(|p| p.into()).collect(),
    ))
}

async fn get_project(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<ProjectResponse>> {
    let project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects
         WHERE id = $1
           AND user_id = $2
           AND status != 'deleted'",
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
        "SELECT * FROM projects
         WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    sqlx::query(
        "UPDATE projects SET status = 'deleted' WHERE id = $1",
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    state
        .event_bus
        .publish(
            "project.deleted",
            &json!({
                "project_id": project.id,
                "kubero_pipeline": project.kubero_pipeline,
                "kubero_app": project.kubero_app,
            }),
        )
        .await;

    Ok(StatusCode::NO_CONTENT)
}

async fn list_builds(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(project_id): Path<Uuid>,
) -> AppResult<Json<Vec<BuildResponse>>> {
    let builds = sqlx::query_as::<_, Build>(
        "SELECT b.* FROM builds b
         JOIN projects p ON p.id = b.project_id
         WHERE b.project_id = $1
           AND p.user_id = $2
         ORDER BY b.created_at DESC
         LIMIT 50",
    )
    .bind(project_id)
    .bind(auth_user.id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(
        builds.into_iter().map(|b| b.into()).collect(),
    ))
}

async fn get_webhook(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects
         WHERE id = $1
           AND user_id = $2
           AND status != 'deleted'",
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

/* ============================================================
   WEBHOOK
   ============================================================ */

async fn handle_webhook(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    headers: axum::http::HeaderMap,
    body: String,
) -> AppResult<StatusCode> {
    let _project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects
         WHERE id = $1 AND status != 'deleted'",
    )
    .bind(project_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    let _signature = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let event = headers
        .get("x-github-event")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("push");

    sqlx::query(
        "INSERT INTO webhook_events
            (project_id, event_type, payload, signature_valid)
         VALUES ($1, $2, $3::jsonb, $4)",
    )
    .bind(project_id)
    .bind(event)
    .bind(&body)
    .bind(false)
    .execute(&state.db)
    .await?;

    state
        .event_bus
        .publish(
            "webhook.received",
            &json!({
                "project_id": project_id,
                "event": event,
            }),
        )
        .await;

    Ok(StatusCode::OK)
}

/* ============================================================
   ADMIN
   ============================================================ */

async fn admin_list_projects(
    State(state): State<AppState>,
) -> AppResult<Json<Vec<ProjectResponse>>> {
    let projects = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects
         WHERE status != 'deleted'
         ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(
        projects.into_iter().map(|p| p.into()).collect(),
    ))
}

async fn admin_delete_project(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    sqlx::query(
        "UPDATE projects SET status = 'deleted' WHERE id = $1",
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    state
        .event_bus
        .publish(
            "project.deleted",
            &json!({
                "project_id": project.id,
                "kubero_pipeline": project.kubero_pipeline,
                "kubero_app": project.kubero_app,
            }),
        )
        .await;

    Ok(StatusCode::NO_CONTENT)
}

async fn cluster_status(
    State(state): State<AppState>,
) -> AppResult<Json<ClusterStatus>> {
    let status = state.kubero.get_cluster_status().await?;
    Ok(Json(status))
}

/* ============================================================
   WEBSOCKET
   ============================================================ */

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| {
        state.ws_manager.handle_socket(socket, auth_user.id)
    })
}

/* ============================================================
   HELPERS
   ============================================================ */

fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}