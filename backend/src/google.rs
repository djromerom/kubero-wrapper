use axum::{extract::State, Extension, Json};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{sync::OnceLock, time::{Duration, Instant}};
use tokio::sync::Mutex;

use crate::{auth::{create_jwt, AuthUser}, error::{AppError, AppResult}, models::{AuthResponse, User}, routes::AppState};

#[derive(Deserialize)]
pub struct Credential { credential: String }

#[derive(Deserialize)]
struct Identity {
    sub: String,
    email: String,
    email_verified: bool,
    name: Option<String>,
}

pub async fn configuration(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "client_id": state.config.google_client_id }))
}

async fn verify(token: &str, client_id: &str) -> AppResult<Identity> {
    if client_id.is_empty() {
        return Err(AppError::ServiceUnavailable("Google aún no está configurado en Atlas.".into()));
    }
    let header = decode_header(token).map_err(|_| AppError::Unauthorized)?;
    if header.alg != Algorithm::RS256 { return Err(AppError::Unauthorized); }
    let kid = header.kid.ok_or(AppError::Unauthorized)?;
    static KEYS: OnceLock<Mutex<Option<(Instant, JwkSet)>>> = OnceLock::new();
    let mut cache = KEYS.get_or_init(|| Mutex::new(None)).lock().await;
    if !cache.as_ref().is_some_and(|(expires, _)| *expires > Instant::now()) {
        let unavailable = |_| AppError::ServiceUnavailable("No se pudieron consultar las claves públicas de Google.".into());
        let response = reqwest::Client::new().get("https://www.googleapis.com/oauth2/v3/certs")
            .timeout(Duration::from_secs(8)).send().await.map_err(unavailable)?.error_for_status().map_err(unavailable)?;
        let ttl = response.headers().get("cache-control").and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').find_map(|s| s.trim().strip_prefix("max-age=")?.parse::<u64>().ok())).unwrap_or(300);
        *cache = Some((Instant::now() + Duration::from_secs(ttl.min(3600)), response.json().await.map_err(unavailable)?));
    }
    let jwk = cache.as_ref().and_then(|(_, keys)| keys.find(&kid)).ok_or(AppError::Unauthorized)?;
    let key = DecodingKey::from_jwk(jwk).map_err(|_| AppError::Unauthorized)?;
    drop(cache);
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&["accounts.google.com", "https://accounts.google.com"]);
    validation.set_audience(&[client_id]);
    validation.set_required_spec_claims(&["sub", "aud", "exp", "iss"]);
    let identity = decode::<Identity>(token, &key, &validation).map_err(|_| AppError::Unauthorized)?.claims;
    if !identity.email_verified || identity.sub.is_empty() || identity.email.is_empty() { return Err(AppError::Unauthorized); }
    Ok(identity)
}

fn session(state: &AppState, user: User) -> AppResult<Json<AuthResponse>> {
    let token = create_jwt(user.id, &user.role, &state.config.jwt_secret, state.config.jwt_expiry_hours)?;
    Ok(Json(AuthResponse { token, user: user.into() }))
}

pub async fn login(State(state): State<AppState>, Json(req): Json<Credential>) -> AppResult<Json<AuthResponse>> {
    let identity = verify(&req.credential, &state.config.google_client_id).await?;
    let existing = sqlx::query_as::<_, User>("SELECT * FROM users WHERE google_sub=$1")
        .bind(&identity.sub).fetch_optional(&state.db).await?;
    if let Some(user) = existing { return session(&state, user); }
    // Email alone cannot establish ownership of an existing Atlas account.
    let user = sqlx::query_as::<_, User>("INSERT INTO users(email,name,google_sub,password_hash)
        SELECT $1,$2,$3,'!' WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email)=lower($1))
        ON CONFLICT DO NOTHING RETURNING *")
        .bind(&identity.email).bind(identity.name.as_deref().unwrap_or(&identity.email)).bind(&identity.sub)
        .fetch_optional(&state.db).await?;
    if let Some(user) = user { return session(&state, user); }
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE google_sub=$1")
        .bind(identity.sub).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::Conflict("Este correo ya tiene cuenta. Inicia sesión con tu contraseña y vincula Google desde tu perfil.".into()))?;
    session(&state, user)
}

pub async fn link(State(state): State<AppState>, Extension(owner): Extension<AuthUser>, Json(req): Json<Credential>) -> AppResult<Json<AuthResponse>> {
    let identity = verify(&req.credential, &state.config.google_client_id).await?;
    let user = sqlx::query_as::<_, User>("UPDATE users SET google_sub=$1 WHERE id=$2 AND lower(email)=lower($3)
        AND (google_sub IS NULL OR google_sub=$1) RETURNING *")
        .bind(identity.sub).bind(owner.id).bind(identity.email).fetch_optional(&state.db).await
        .map_err(|e| if e.as_database_error().is_some_and(|db| db.is_unique_violation()) {
            AppError::Conflict("Esta cuenta de Google ya está vinculada.".into())
        } else { e.into() })?
        .ok_or_else(|| AppError::Conflict("Elige la cuenta de Google correspondiente al correo de tu perfil.".into()))?;
    session(&state, user)
}
