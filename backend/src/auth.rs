use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
    Json,
};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde_json::json;
use uuid::Uuid;

use crate::{error::AppResult, models::Claims};

pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    Ok(argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| crate::error::AppError::Internal(e.to_string()))?
        .to_string())
}

pub fn verify_password(password: &str, hash: &str) -> AppResult<bool> {
    let parsed_hash = PasswordHash::new(hash)
        .map_err(|e| crate::error::AppError::Internal(e.to_string()))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

pub fn create_jwt(user_id: Uuid, role: &str, secret: &str, expiry_hours: i64) -> AppResult<String> {
    let now = chrono::Utc::now();
    let claims = Claims {
        sub: user_id.to_string(),
        role: role.to_string(),
        iat: now.timestamp() as usize,
        exp: (now + chrono::Duration::hours(expiry_hours)).timestamp() as usize,
    };
    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

pub fn verify_jwt(token: &str, secret: &str) -> AppResult<Claims> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(token_data.claims)
}

#[derive(Clone)]
pub struct AuthUser {
    pub id: Uuid,
    pub role: String,
}

pub async fn auth_middleware(
    State(config): State<crate::config::Config>,
    mut req: Request,
    next: Next,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let auth_header = req
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Missing or invalid Authorization header"})),
        ))?;

    match verify_jwt(auth_header, &config.jwt_secret) {
        Ok(claims) => {
            let auth_user = AuthUser {
                id: Uuid::parse_str(&claims.sub).unwrap_or_default(),
                role: claims.role,
            };
            req.extensions_mut().insert(auth_user);
            Ok(next.run(req).await)
        }
        Err(_) => Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Invalid or expired token"})),
        )),
    }
}

pub async fn admin_middleware(
    req: Request,
    next: Next,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let auth_user = req.extensions().get::<AuthUser>().ok_or((
        StatusCode::UNAUTHORIZED,
        Json(json!({"error": "Authentication required"})),
    ))?;

    if auth_user.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Admin access required"})),
        ));
    }

    Ok(next.run(req).await)
}
