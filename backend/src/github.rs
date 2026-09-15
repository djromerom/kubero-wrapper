use std::{collections::HashMap, time::Duration};

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Redirect,
    Extension, Json,
};
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::GitHubAccount,
    routes::AppState,
};

const USER_AGENT: &str = "Atlas-Kubero-Wrapper";

#[derive(Debug, Serialize, Deserialize)]
struct GitHubStateClaims {
    sub: String,
    purpose: String,
    iat: usize,
    exp: usize,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GitHubCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    installation_id: Option<i64>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct LatestCommitQuery {
    branch: String,
}

fn client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| AppError::Internal(error.to_string()))
}

fn ensure_configured(state: &AppState) -> AppResult<()> {
    if state.config.github_app_id.is_empty()
        || state.config.github_app_slug.is_empty()
        || state.config.github_client_id.is_empty()
        || state.config.github_client_secret.is_empty()
    {
        return Err(AppError::Internal(
            "GitHub App is not configured; set GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET".into(),
        ));
    }
    Ok(())
}

pub(crate) async fn status(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<Value>> {
    let account = sqlx::query_as::<_, GitHubAccount>(
        "SELECT user_id, github_user_id, github_login, access_token FROM github_accounts WHERE user_id = $1",
    )
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?;

    Ok(Json(match account {
        Some(account) => json!({
            "linked": true,
            "login": account.github_login,
            "github_user_id": account.github_user_id,
        }),
        None => json!({ "linked": false }),
    }))
}

/// Returns the installation URL as JSON so the frontend can authenticate this
/// request with the Atlas bearer token before navigating away to GitHub.
pub(crate) async fn connect(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<Value>> {
    ensure_configured(&state)?;
    let now = Utc::now();
    let claims = GitHubStateClaims {
        sub: auth_user.id.to_string(),
        purpose: "github_connect".into(),
        iat: now.timestamp() as usize,
        exp: (now + chrono::Duration::minutes(10)).timestamp() as usize,
    };
    let state_token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.config.jwt_secret.as_bytes()),
    )?;
    Ok(Json(json!({
        "authorization_url": format!(
            "https://github.com/apps/{}/installations/new?state={}",
            state.config.github_app_slug, state_token
        )
    })))
}

pub(crate) async fn callback(
    State(state): State<AppState>,
    Query(query): Query<GitHubCallbackQuery>,
) -> AppResult<Redirect> {
    ensure_configured(&state)?;
    if let Some(error) = query.error {
        return Err(AppError::BadRequest(
            query.error_description.unwrap_or(error),
        ));
    }

    let code = query
        .code
        .ok_or_else(|| AppError::BadRequest("Missing GitHub authorization code".into()))?;
    let state_token = query
        .state
        .ok_or_else(|| AppError::BadRequest("Missing GitHub state".into()))?;
    let claims = decode::<GitHubStateClaims>(
        &state_token,
        &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
        &Validation::default(),
    )?
    .claims;
    if claims.purpose != "github_connect" {
        return Err(AppError::BadRequest("Invalid GitHub state".into()));
    }
    let atlas_user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| AppError::BadRequest("Invalid GitHub state subject".into()))?;

    let http = client()?;
    let token_response = http
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT)
        .json(&json!({
            "client_id": state.config.github_client_id,
            "client_secret": state.config.github_client_secret,
            "code": code,
            "redirect_uri": state.config.github_callback_url,
        }))
        .send()
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    if !token_response.status().is_success() {
        return Err(AppError::BadRequest("GitHub authorization failed".into()));
    }
    let token_data: Value = token_response
        .json()
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    let access_token = token_data
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::BadRequest("GitHub did not return an access token".into()))?;

    let user_response = http
        .get("https://api.github.com/user")
        .bearer_auth(access_token)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    if !user_response.status().is_success() {
        return Err(AppError::BadRequest("Unable to retrieve GitHub user".into()));
    }
    let github_user: Value = user_response
        .json()
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    let github_user_id = github_user
        .get("id")
        .and_then(Value::as_i64)
        .ok_or_else(|| AppError::Internal("GitHub user ID not found".into()))?;
    let github_login = github_user
        .get("login")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Internal("GitHub login not found".into()))?;

    let configured_app_id = state
        .config
        .github_app_id
        .parse::<i64>()
        .map_err(|_| AppError::Internal("GITHUB_APP_ID must be a number".into()))?;
    let installations = fetch_installations(&http, access_token).await?;
    let valid_installation = installations.iter().any(|installation| {
        installation.get("app_id").and_then(Value::as_i64) == Some(configured_app_id)
            && query.installation_id.map_or(true, |expected| {
                installation.get("id").and_then(Value::as_i64) == Some(expected)
            })
    });
    if !valid_installation {
        return Err(AppError::Forbidden);
    }

    sqlx::query(
        "INSERT INTO github_accounts (user_id, github_user_id, github_login, access_token) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (user_id) DO UPDATE SET github_user_id = EXCLUDED.github_user_id, \
         github_login = EXCLUDED.github_login, access_token = EXCLUDED.access_token, updated_at = NOW()",
    )
    .bind(atlas_user_id)
    .bind(github_user_id)
    .bind(github_login)
    .bind(access_token)
    .execute(&state.db)
    .await?;
    sqlx::query("UPDATE users SET github_id = $1, updated_at = NOW() WHERE id = $2")
        .bind(github_user_id.to_string())
        .bind(atlas_user_id)
        .execute(&state.db)
        .await?;

    let destination = format!("{}/?github=connected", state.config.frontend_url.trim_end_matches('/'));
    Ok(Redirect::to(&destination))
}

async fn account(state: &AppState, user_id: Uuid) -> AppResult<GitHubAccount> {
    sqlx::query_as::<_, GitHubAccount>(
        "SELECT user_id, github_user_id, github_login, access_token FROM github_accounts WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::BadRequest("GitHub account is not linked".into()))
}

async fn fetch_installations(http: &reqwest::Client, token: &str) -> AppResult<Vec<Value>> {
    let response = http
        .get("https://api.github.com/user/installations")
        .bearer_auth(token)
        .header("User-Agent", USER_AGENT)
        .query(&[("per_page", "100")])
        .send()
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    if response.status() == StatusCode::UNAUTHORIZED {
        return Err(AppError::Unauthorized);
    }
    if !response.status().is_success() {
        return Err(AppError::BadRequest("Unable to retrieve GitHub installations".into()));
    }
    let data: Value = response
        .json()
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    Ok(data
        .get("installations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

async fn installation_ids(state: &AppState, account: &GitHubAccount) -> AppResult<Vec<i64>> {
    let app_id = state
        .config
        .github_app_id
        .parse::<i64>()
        .map_err(|_| AppError::Internal("GITHUB_APP_ID must be a number".into()))?;
    Ok(fetch_installations(&client()?, &account.access_token)
        .await?
        .into_iter()
        .filter(|item| item.get("app_id").and_then(Value::as_i64) == Some(app_id))
        .filter_map(|item| item.get("id").and_then(Value::as_i64))
        .collect())
}

async fn repository_values(state: &AppState, account: &GitHubAccount) -> AppResult<Vec<Value>> {
    let http = client()?;
    let mut repositories = HashMap::new();
    for installation_id in installation_ids(state, account).await? {
        let response = http
            .get(format!(
                "https://api.github.com/user/installations/{installation_id}/repositories"
            ))
            .bearer_auth(&account.access_token)
            .header("User-Agent", USER_AGENT)
            .query(&[("per_page", "100")])
            .send()
            .await
            .map_err(|error| AppError::Internal(error.to_string()))?;
        if !response.status().is_success() {
            continue;
        }
        let data: Value = response
            .json()
            .await
            .map_err(|error| AppError::Internal(error.to_string()))?;
        for repository in data
            .get("repositories")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            if let Some(id) = repository.get("id").and_then(Value::as_i64) {
                repositories.insert(id, repository);
            }
        }
    }
    Ok(repositories.into_values().collect())
}

async fn verify_repository(
    state: &AppState,
    account: &GitHubAccount,
    owner: &str,
    repo: &str,
) -> AppResult<()> {
    let expected = format!("{owner}/{repo}").to_lowercase();
    if repository_values(state, account).await?.iter().any(|repository| {
        repository
            .get("full_name")
            .and_then(Value::as_str)
            .is_some_and(|name| name.to_lowercase() == expected)
    }) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

pub(crate) async fn repositories(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<Value>> {
    let account = account(&state, auth_user.id).await?;
    Ok(Json(json!({ "repositories": repository_values(&state, &account).await? })))
}

pub(crate) async fn branches(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path((owner, repo)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    let account = account(&state, auth_user.id).await?;
    verify_repository(&state, &account, &owner, &repo).await?;
    let response = client()?
        .get(format!("https://api.github.com/repos/{owner}/{repo}/branches"))
        .bearer_auth(&account.access_token)
        .header("User-Agent", USER_AGENT)
        .query(&[("per_page", "100")])
        .send()
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::BadRequest("Unable to retrieve GitHub branches".into()));
    }
    let branches: Value = response
        .json()
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    Ok(Json(json!({ "owner": owner, "repository": repo, "branches": branches })))
}

async fn latest_commit_value(
    account: &GitHubAccount,
    owner: &str,
    repo: &str,
    branch: &str,
) -> AppResult<Value> {
    if branch.trim().is_empty() {
        return Err(AppError::BadRequest("Branch cannot be empty".into()));
    }
    let response = client()?
        .get(format!("https://api.github.com/repos/{owner}/{repo}/commits"))
        .bearer_auth(&account.access_token)
        .header("User-Agent", USER_AGENT)
        .query(&[("sha", branch), ("per_page", "1")])
        .send()
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::BadRequest("Unable to retrieve latest GitHub commit".into()));
    }
    response
        .json::<Vec<Value>>()
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?
        .into_iter()
        .next()
        .ok_or(AppError::NotFound)
}

pub(crate) async fn latest_commit(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path((owner, repo)): Path<(String, String)>,
    Query(query): Query<LatestCommitQuery>,
) -> AppResult<Json<Value>> {
    let account = account(&state, auth_user.id).await?;
    verify_repository(&state, &account, &owner, &repo).await?;
    let commit = latest_commit_value(&account, &owner, &repo, &query.branch).await?;
    Ok(Json(json!({
        "owner": owner,
        "repository": repo,
        "branch": query.branch,
        "commit": commit,
    })))
}

fn parse_repository_url(repo_url: &str) -> AppResult<(String, String)> {
    let path = repo_url
        .trim()
        .strip_prefix("https://github.com/")
        .ok_or_else(|| AppError::BadRequest("Repository must be a GitHub HTTPS URL".into()))?
        .trim_end_matches('/')
        .trim_end_matches(".git");
    let parts = path.split('/').collect::<Vec<_>>();
    if parts.len() != 2 || parts.iter().any(|part| part.is_empty()) {
        return Err(AppError::BadRequest(
            "Expected repository URL in the form https://github.com/owner/repository".into(),
        ));
    }
    Ok((parts[0].into(), parts[1].into()))
}

/// Revalidates ownership and branch at project creation time; selectors in the
/// browser are never treated as an authorization boundary.
pub(crate) async fn validate_project_source(
    state: &AppState,
    user_id: Uuid,
    repo_url: &str,
    branch: &str,
) -> AppResult<(String, String)> {
    let account = account(state, user_id).await?;
    let (owner, repo) = parse_repository_url(repo_url)?;
    verify_repository(state, &account, &owner, &repo).await?;
    let commit = latest_commit_value(&account, &owner, &repo, branch).await?;
    let sha = commit
        .get("sha")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Internal("GitHub commit SHA not found".into()))?;
    let message = commit
        .get("commit")
        .and_then(|value| value.get("message"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    Ok((sha.into(), message.into()))
}
