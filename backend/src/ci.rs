use axum::{extract::{Path, Query, State}, http::{HeaderMap, StatusCode}, Extension, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;
use crate::{auth::AuthUser, ci_clients::{CiConfig, Pipeline, RemoteError}, error::{AppError, AppResult}, github, models::{Project, ProjectResponse}, routes::AppState};

#[derive(Debug, Serialize, FromRow, Clone)]
pub struct CiRun {
    pub id: Uuid,
    pub project_id: Uuid,
    pub repo_url: String,
    pub branch: String,
    pub commit_sha: String,
    pub status: String,
    pub mode: String,
    pub woodpecker_repo_id: Option<i64>,
    pub pipeline_id: Option<i64>,
    pub pipeline_number: Option<i64>,
    pub image_repository: Option<String>,
    pub image_tag: String,
    pub image_digest: Option<String>,
    pub image_reference: Option<String>,
    pub platform: String,
    pub message: Option<String>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip)]
    pub woodpecker_url: Option<String>,
    #[serde(skip)]
    pub registry_url: Option<String>,
    #[serde(skip)]
    pub expected_author: Option<String>,
    #[serde(skip)]
    pub authorization_expires_at: Option<DateTime<Utc>>,
    #[serde(skip)]
    pub lease_id: Option<Uuid>,
}

/// Called inside the same transaction as project creation / explicit retry.
pub async fn enqueue(db: &mut PgConnection, config: &CiConfig, project: Uuid, repo: &str, branch: &str, sha: &str) -> AppResult<Uuid> {
    let id = Uuid::new_v4();
    let reason = config.blocked_reason(repo);
    sqlx::query("INSERT INTO ci_runs(id,project_id,repo_url,branch,commit_sha,status,mode,image_tag,message) VALUES ($1,$2,$3,$4,$5,$6,$7,$1::text,$8)")
        .bind(id).bind(project).bind(repo).bind(branch).bind(sha.to_ascii_lowercase())
        .bind(if reason.is_some() { "blocked" } else { "queued" }).bind(&config.mode).bind(reason)
        .execute(db).await?;
    Ok(id)
}

pub async fn response(state: &AppState, project: Project) -> AppResult<ProjectResponse> {
    let latest = sqlx::query_as::<_, CiRun>("SELECT * FROM ci_runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1")
        .bind(project.id).fetch_optional(&state.db).await?;
    let mut response: ProjectResponse = project.into();
    response.ci_managed = latest.is_some();
    response.ci = latest;
    Ok(response)
}

async fn authorize(state: &AppState, user: &AuthUser, id: Uuid) -> AppResult<()> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE id=$1 AND (user_id=$2 OR $3) AND status!='deleted')")
        .bind(id).bind(user.id).bind(user.role == "admin").fetch_one(&state.db).await?;
    if !exists { return Err(AppError::NotFound); }
    Ok(())
}

pub async fn list(State(state): State<AppState>, Extension(user): Extension<AuthUser>, Path(id): Path<Uuid>) -> AppResult<Json<Vec<CiRun>>> {
    authorize(&state, &user, id).await?;
    Ok(Json(sqlx::query_as("SELECT * FROM ci_runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 50")
        .bind(id).fetch_all(&state.db).await?))
}

pub async fn retry(State(state): State<AppState>, Extension(user): Extension<AuthUser>, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    // Authorization still belongs to the developer's linked GitHub account.
    let (owner, repo, branch) = sqlx::query_as::<_, (Uuid, String, String)>(
        "SELECT user_id,repo_url,branch FROM projects WHERE id=$1 AND user_id=$2 AND ci_managed AND status!='deleted' AND deletion_requested_at IS NULL")
        .bind(id).bind(user.id).fetch_optional(&state.db).await?.ok_or(AppError::NotFound)?;
    let (sha, _) = github::validate_project_source(&state, owner, &repo, &branch).await?;
    let mut tx = state.db.begin().await?;
    let locked: Option<Uuid> = sqlx::query_scalar("SELECT id FROM projects WHERE id=$1 AND status!='deleted' AND deletion_requested_at IS NULL FOR UPDATE")
        .bind(id).fetch_optional(&mut *tx).await?;
    if locked.is_none() { return Err(AppError::NotFound); }
    let active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM ci_runs WHERE project_id=$1 AND completed_at IS NULL)")
        .bind(id).fetch_one(&mut *tx).await?;
    if active { return Err(AppError::Conflict("Ya existe una construcción pendiente. Atlas está comprobando su estado.".into())); }
    enqueue(&mut tx, &state.config.ci, id, &repo, &branch, &sha).await?;
    sqlx::query("UPDATE projects SET source_commit=$2, updated_at=NOW() WHERE id=$1")
        .bind(id).bind(sha).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Service-to-service contract for the central configuration extension / isolated publisher.
/// This is NOT Woodpecker's configuration-extension endpoint and returns no YAML or credentials.
#[derive(Deserialize)]
pub struct AuthorizationQuery { purpose: Option<String> }

pub async fn authorization(State(state): State<AppState>, Path(id): Path<String>, Query(query): Query<AuthorizationQuery>, headers: HeaderMap) -> AppResult<([( &'static str, &'static str); 1], Json<serde_json::Value>)> {
    let config = &state.config.ci;
    let purpose = query.purpose.as_deref().unwrap_or("configuration");
    let expected = match purpose {
        "configuration" => &config.authorization_token,
        "publication" => &config.publication_token,
        _ => return Err(AppError::Unauthorized),
    };
    let supplied = headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("");
    // Compare fixed-size digests; never log tokens or put them in URLs.
    let a = crate::ci_clients::digest(expected.as_bytes());
    let b = crate::ci_clients::digest(supplied.as_bytes());
    let mismatch = a.bytes().zip(b.bytes()).fold(0u8, |diff, (x, y)| diff | (x ^ y));
    if expected.len() < 32 || mismatch != 0 || config.authorization_token == config.publication_token
        || !config.enabled || !config.central_ready || config.mode != "central" {
        return Err(AppError::Unauthorized);
    }
    let id = Uuid::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let run = sqlx::query_as::<_, CiRun>("SELECT c.* FROM ci_runs c JOIN projects p ON p.id=c.project_id WHERE c.id=$1 AND p.status!='deleted' AND p.deletion_requested_at IS NULL AND c.mode='central'")
        .bind(id).fetch_optional(&state.db).await?.ok_or(AppError::NotFound)?;
    let now = Utc::now();
    let valid_window = run.submitted_at.zip(run.authorization_expires_at)
        .is_some_and(|(start, end)| start <= now && now < end && end > start);
    let active = ["pending","running","verifying"].contains(&run.status.as_str());
    if !(active || (purpose == "configuration" && run.status == "submitting"))
        || run.completed_at.is_some() || !valid_window || !context_matches(&run, config)
        || !run.woodpecker_repo_id.is_some_and(|id| id > 0)
        || (purpose == "publication" && (!run.pipeline_id.is_some_and(|id| id > 0) || !run.pipeline_number.is_some_and(|id| id > 0)))
        || run.image_tag != run.id.to_string() || run.platform != "linux/arm64" {
        return Err(AppError::Conflict("La ejecución no autoriza una construcción o publicación.".into()));
    }
    Ok(([ ("cache-control", "no-store") ], Json(json!({
        "contract_version":2, "purpose":purpose, "run_id":run.id, "project_id":run.project_id,
        "repo_url":run.repo_url, "branch":run.branch, "commit_sha":run.commit_sha,
        "woodpecker_repo_id":run.woodpecker_repo_id, "pipeline_id":run.pipeline_id,
        "pipeline_number":run.pipeline_number, "event":"manual",
        "expected_author":run.expected_author, "woodpecker_url":run.woodpecker_url,
        "expected_message":format!("MANUAL: atlas:{} @ {}",run.id,run.branch),
        "registry":run.registry_url, "image_repository":run.image_repository,
        "image_tag":run.image_tag, "platform":run.platform,
        "expires_at":run.authorization_expires_at
    }))))
}

fn context_matches(run: &CiRun, config: &CiConfig) -> bool {
    run.woodpecker_url.as_deref() == Some(config.woodpecker_url.as_str())
        && run.registry_url.as_deref() == Some(config.registry_url.as_str())
        && run.expected_author.as_deref() == Some(config.expected_author.as_str())
        && run.image_repository.as_deref() == Some(format!("{}/{}", config.registry_namespace, run.project_id).as_str())
}

pub fn start_worker(state: AppState) {
    if state.ci_clients.is_none() { return; }
    tokio::spawn(async move {
        loop {
            if tick(&state).await.is_err() {
                // Do not serialize database errors: they can contain application data.
                tracing::warn!("CI worker could not persist or process a run; it will retry");
            }
            tokio::time::sleep(std::time::Duration::from_secs(state.config.ci.poll_seconds)).await;
        }
    });
}

pub async fn tick(state: &AppState) -> AppResult<()> {
    let lease = Uuid::new_v4();
    let run = sqlx::query_as::<_, CiRun>(
        "WITH candidate AS (SELECT c.id FROM ci_runs c JOIN projects p ON p.id=c.project_id \
         WHERE c.completed_at IS NULL AND c.next_poll_at<=NOW() AND (c.lease_until IS NULL OR c.lease_until<NOW()) \
         AND p.status!='deleted' AND p.deletion_requested_at IS NULL ORDER BY c.next_poll_at FOR UPDATE OF c SKIP LOCKED LIMIT 1) \
         UPDATE ci_runs c SET lease_id=$1,lease_until=NOW()+interval '5 minutes' FROM candidate WHERE c.id=candidate.id RETURNING c.*")
        .bind(lease).fetch_optional(&state.db).await?;
    if let Some(run) = run { process(state, run).await?; }
    Ok(())
}

async fn save(state: &AppState, run: &CiRun, status: &str, message: Option<&str>, terminal: bool) -> AppResult<()> {
    sqlx::query("UPDATE ci_runs SET status=$3,message=$4,completed_at=CASE WHEN $5 THEN NOW() ELSE NULL END,updated_at=NOW(), \
        next_poll_at=NOW()+($6 * interval '1 second'),lease_id=NULL,lease_until=NULL WHERE id=$1 AND lease_id=$2")
        .bind(run.id).bind(run.lease_id).bind(status).bind(message).bind(terminal)
        .bind(state.config.ci.poll_seconds as i64).execute(&state.db).await?;
    Ok(())
}

fn matching(run: &CiRun, p: &Pipeline) -> bool {
    p.id > 0 && p.number > 0 && Some(p.repo_id) == run.woodpecker_repo_id
        && p.commit == run.commit_sha && p.branch == run.branch && p.event == "manual"
        && p.message == format!("MANUAL: atlas:{} @ {}", run.id, run.branch)
        && run.pipeline_id.is_none_or(|id| id == p.id)
        && run.pipeline_number.is_none_or(|number| number == p.number)
}

async fn process(state: &AppState, mut run: CiRun) -> AppResult<()> {
    let config = &state.config.ci;
    let clients = state.ci_clients.as_ref().ok_or_else(|| AppError::Internal("CI disabled".into()))?;
    if let Some(reason) = config.blocked_reason(&run.repo_url) {
        // Never reclassify an uncertain submission as a fresh queued run.
        let status = if run.submitted_at.is_some() { run.status.as_str() } else { "blocked" };
        return save(state, &run, status, Some(reason), false).await;
    }
    if run.mode != config.mode {
        return save(state, &run, &run.status, Some("La modalidad CI cambió. Requiere revisión del operador."), false).await;
    }
    if run.submitted_at.is_some() && !context_matches(&run, config) {
        return save(state, &run, &run.status, Some("El destino o la cuenta CI cambió. Requiere conciliación del operador."), false).await;
    }
    let timed_out = run.submitted_at.is_some() && run.authorization_expires_at.is_none_or(|end| Utc::now() >= end);
    if ["queued", "blocked"].contains(&run.status.as_str()) {
        let owner: Uuid = sqlx::query_scalar("SELECT user_id FROM projects WHERE id=$1")
            .bind(run.project_id).fetch_one(&state.db).await?;
        match github::validate_project_source(state, owner, &run.repo_url, &run.branch).await {
            Ok((sha, _)) if sha == run.commit_sha => {},
            Ok(_) => return save(state,&run,"failed",Some("La rama cambió desde el registro. Solicita construir su versión actual."),true).await,
            Err(_) => return save(state,&run,"blocked",Some("No se pudo revalidar el acceso a GitHub. Revisa la cuenta vinculada y los permisos."),false).await,
        }
        let name = run.repo_url.strip_prefix("https://github.com/").unwrap_or("");
        let repo = match clients.repository(name).await {
            Ok(repo) => repo,
            Err(e) => return save(state,&run,"blocked",Some(e.message()),false).await,
        };
        let repository = clients.image_repository(run.project_id);
        // Persist intent BEFORE POST. Crash or lost response => reconcile only, never blind resubmit.
        let updated = sqlx::query("UPDATE ci_runs SET status='submitting',woodpecker_repo_id=$3,image_repository=$4,submitted_at=NOW(),updated_at=NOW(),woodpecker_url=$5,registry_url=$6,expected_author=$7,authorization_expires_at=NOW()+($8 * interval '1 second') WHERE id=$1 AND lease_id=$2")
            .bind(run.id).bind(run.lease_id).bind(repo.id).bind(&repository)
            .bind(&config.woodpecker_url).bind(&config.registry_url).bind(&config.expected_author)
            .bind(config.run_timeout_seconds).execute(&state.db).await?;
        if updated.rows_affected() == 0 { return Ok(()); }
        run = sqlx::query_as("SELECT * FROM ci_runs WHERE id=$1").bind(run.id).fetch_one(&state.db).await?;
        match clients.trigger(repo.id, &run.branch, run.id, &run.commit_sha, run.image_repository.as_deref().unwrap()).await {
            Ok(p) => return accept_pipeline(state,&run,p).await,
            // Even 5xx/invalid responses can follow a successful side effect.
            Err(_) => return save(state,&run,"submission_unknown",Some("Confirmando si Woodpecker recibió la solicitud; no se enviará otra."),false).await,
        }
    }
    if run.pipeline_number.is_none() {
        let Some(repo) = run.woodpecker_repo_id else {
            return save(state,&run,"submission_unknown",Some("Falta la identidad de Woodpecker. Requiere revisión del operador."),false).await;
        };
        return match clients.find_pipeline(repo, &run.branch, run.id).await {
            Ok(Some(p)) => accept_pipeline(state,&run,p).await,
            Ok(None) => save(state,&run,"submission_unknown",Some(if timed_out {
                "No se confirmó la ejecución. El operador debe conciliar la solicitud; no es seguro repetirla."
            } else { "Esperando confirmar la solicitud en Woodpecker." }),false).await,
            Err(e) => save(state,&run,"submission_unknown",Some(e.message()),false).await,
        };
    }
    let p = match clients.pipeline(run.woodpecker_repo_id.unwrap(),run.pipeline_number.unwrap()).await {
        Ok(p) => p,
        Err(e) => return save(state,&run,&run.status,Some(e.message()),false).await,
    };
    accept_pipeline(state,&run,p).await
}

async fn accept_pipeline(state: &AppState, run: &CiRun, pipeline: Pipeline) -> AppResult<()> {
    if !matching(run, &pipeline) || pipeline.author != state.config.ci.expected_author {
        // Preserve the remote identifiers for investigation; do not label any image as published.
        return save(state,run,"submission_unknown",Some("Woodpecker devolvió una ejecución o commit diferente. Publicación bloqueada; requiere conciliación."),false).await;
    }
    let result = sqlx::query("UPDATE ci_runs SET pipeline_id=$3,pipeline_number=$4 WHERE id=$1 AND lease_id=$2")
        .bind(run.id).bind(run.lease_id).bind(pipeline.id).bind(pipeline.number).execute(&state.db).await?;
    if result.rows_affected() == 0 { return Ok(()); }
    let status = match pipeline.status.as_str() {
        "pending" | "blocked" => "pending", "running" => "running", "success" => "verifying",
        "failure" | "error" | "killed" => "failed", "declined" | "skipped" => "cancelled",
        _ => return save(state,run,"submission_unknown",Some("Estado de Woodpecker no reconocido."),false).await,
    };
    if status == "verifying" {
        if run.authorization_expires_at.is_none_or(|end| Utc::now() >= end) {
            return save(state,run,"failed",Some("Woodpecker terminó, pero no se verificó una imagen válida dentro del plazo de publicación."),true).await;
        }
        let clients = state.ci_clients.as_ref().unwrap();
        match clients.verify_image(run.image_repository.as_deref().unwrap(), &run.image_tag).await {
            Ok(digest) => {
                let reference = clients.image_reference(run.image_repository.as_deref().unwrap(), &digest);
                sqlx::query("UPDATE ci_runs SET image_digest=$3,image_reference=$4 WHERE id=$1 AND lease_id=$2")
                    .bind(run.id).bind(run.lease_id).bind(digest).bind(reference).execute(&state.db).await?;
                return save(state,run,"published",Some("Imagen publicada y verificada para linux/arm64. Despliegue pendiente de integración."),true).await;
            }
            Err(RemoteError::Invalid) => return save(state,run,"failed",Some("La imagen no tiene un digest válido o no corresponde a linux/arm64."),true).await,
            Err(e) => return save(state,run,"verifying",Some(e.message()),false).await,
        }
    }
    let terminal = matches!(status,"failed"|"cancelled");
    let timeout = run.authorization_expires_at.is_none_or(|end| Utc::now() >= end);
    save(state,run,status,if terminal { Some("La construcción no terminó correctamente. Consulta la ejecución de CI.") }
        else if timeout { Some("CI superó el plazo. Atlas seguirá comprobando la ejecución antes de permitir otra.") }
        else { None },terminal).await
}
