use anyhow::{ensure, Context, Result};
use reqwest::{Client, Method, StatusCode};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{
    net::TcpListener,
    process::{Child, Command, Stdio},
    time::Duration,
};
use uuid::Uuid;

struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct Fixture {
    http: Client,
    base: String,
    db: PgPool,
    users: Vec<Uuid>,
}

impl Fixture {
    async fn request(
        &self,
        method: Method,
        route: &str,
        token: &str,
        body: Value,
        expected: StatusCode,
    ) -> Result<Value> {
        let mut request = self.http.request(method, format!("{}{route}", self.base));
        if !token.is_empty() {
            request = request.bearer_auth(token);
        }
        if !body.is_null() {
            request = request.json(&body);
        }
        let response = request.send().await?;
        ensure!(
            response.status() == expected,
            "{route}: expected {expected}, got {}",
            response.status()
        );
        Ok(response.json().await?)
    }

    async fn account(&mut self) -> Result<(Uuid, String, String, String)> {
        let email = format!("atlas-rust-test-{}@example.invalid", Uuid::new_v4());
        let password = Uuid::new_v4().to_string();
        let value = self
            .request(
                Method::POST,
                "/auth/register",
                "",
                json!({"name":"Integration", "email":email, "password":password}),
                StatusCode::CREATED,
            )
            .await?;
        let id = Uuid::parse_str(value["user"]["id"].as_str().context("Missing user ID")?)?;
        self.users.push(id);
        let token = value["token"].as_str().context("Missing token")?.to_owned();
        Ok((id, token, email, password))
    }

    async fn checks(&mut self) -> Result<()> {
        self.request(
            Method::GET,
            "/projects",
            "",
            Value::Null,
            StatusCode::UNAUTHORIZED,
        )
        .await?;
        let (owner, owner_token, email, password) = self.account().await?;
        self.request(
            Method::POST,
            "/auth/register",
            "",
            json!({"name":"Duplicate", "email":email, "password":password}),
            StatusCode::CONFLICT,
        )
        .await?;
        self.request(
            Method::POST,
            "/auth/login",
            "",
            json!({"email":email, "password":"wrong-password"}),
            StatusCode::UNAUTHORIZED,
        )
        .await?;
        let login = self
            .request(
                Method::POST,
                "/auth/login",
                "",
                json!({"email":email, "password":password}),
                StatusCode::OK,
            )
            .await?;
        ensure!(
            login["user"]["id"] == owner.to_string(),
            "Login returned another account"
        );
        let list = self
            .request(
                Method::GET,
                "/projects",
                &owner_token,
                Value::Null,
                StatusCode::OK,
            )
            .await?;
        ensure!(
            list.as_array().context("Expected project list")?.is_empty(),
            "New account has projects"
        );
        let (_, other_token, _, _) = self.account().await?;
        let (admin, _, admin_email, admin_password) = self.account().await?;
        sqlx::query("UPDATE users SET role='admin' WHERE id=$1")
            .bind(admin)
            .execute(&self.db)
            .await?;
        let login = self
            .request(
                Method::POST,
                "/auth/login",
                "",
                json!({"email":admin_email, "password":admin_password}),
                StatusCode::OK,
            )
            .await?;
        let admin_token = login["token"].as_str().context("Missing admin token")?;
        let project = Uuid::new_v4();
        sqlx::query("INSERT INTO projects(id,user_id,name,slug,repo_url,purpose) VALUES ($1,$2,'Integration',$3,'https://github.com/example/fixture','Integration')")
            .bind(project).bind(owner).bind(format!("atlas-rust-test-{project}")).execute(&self.db).await?;
        let route = format!("/projects/{project}");
        let review = format!("/admin/projects/{project}/review");
        let p = self
            .request(
                Method::GET,
                &route,
                &owner_token,
                Value::Null,
                StatusCode::OK,
            )
            .await?;
        ensure!(p["status"] == "pending", "New projects must await administrative review");
        self.request(
            Method::GET,
            &route,
            &other_token,
            Value::Null,
            StatusCode::NOT_FOUND,
        )
        .await?;
        self.request(
            Method::POST,
            &format!("{route}/deployment/retry"),
            &other_token,
            json!({}),
            StatusCode::NOT_FOUND,
        )
        .await?;
        self.request(
            Method::POST,
            &review,
            &owner_token,
            json!({"decision":"approve"}),
            StatusCode::FORBIDDEN,
        )
        .await?;
        self.request(
            Method::POST,
            &review,
            admin_token,
            json!({"decision":"approve"}),
            StatusCode::CONFLICT,
        )
        .await?;
        sqlx::query("UPDATE projects SET status='pending', source_commit=$2, adaptation_report=$3 WHERE id=$1")
            .bind(project).bind("a".repeat(40)).bind(json!({"outcome":"intervention_required", "build_verified":false, "blockers":["Fixture"]})).execute(&self.db).await?;
        let p = self
            .request(
                Method::GET,
                &route,
                admin_token,
                Value::Null,
                StatusCode::OK,
            )
            .await?;
        ensure!(
            p["adaptation_report"]["outcome"] == "intervention_required",
            "Admin cannot see adaptation report"
        );
        self.request(
            Method::POST,
            &review,
            admin_token,
            json!({"decision":"corrections", "note":" "}),
            StatusCode::BAD_REQUEST,
        )
        .await?;
        for fields in [json!([]), json!(["deployment_config"]), json!(["purpose", "purpose"])] {
            self.request(Method::POST, &review, admin_token,
                json!({"decision":"corrections", "note":"Select fields", "correction_fields":fields}),
                StatusCode::BAD_REQUEST).await?;
        }
        let p = self
            .request(
                Method::POST,
                &review,
                admin_token,
                json!({"decision":"corrections", "note":"Academic correction", "correction_fields":["name", "purpose"]}),
                StatusCode::OK,
            )
            .await?;
        ensure!(
            p["status"] == "corrections" && p["review_note"] == "Academic correction",
            "The administrative correction was not saved"
        );
        ensure!(p["correction_fields"] == json!(["name", "purpose"]), "The selected correction fields were not returned");
        let saved = self.request(Method::GET, &route, &owner_token, Value::Null, StatusCode::OK).await?;
        ensure!(saved["correction_fields"] == json!(["name", "purpose"]), "Selected fields were not persisted");
        self.request(Method::POST, &format!("{route}/resubmit"), &other_token,
            json!({"name":"Updated project", "purpose":"Updated purpose"}), StatusCode::CONFLICT).await?;
        self.request(Method::POST, &format!("{route}/resubmit"), &owner_token,
            json!({"purpose":"Updated purpose"}), StatusCode::BAD_REQUEST).await?;
        self.request(Method::POST, &format!("{route}/resubmit"), &owner_token,
            json!({"name":"Updated project", "purpose":"Updated purpose", "course":"Unrequested change"}), StatusCode::BAD_REQUEST).await?;
        let resubmitted = self.request(Method::POST, &format!("{route}/resubmit"), &owner_token,
            json!({"name":"Updated project", "purpose":"Updated purpose"}), StatusCode::OK).await?;
        ensure!(resubmitted["status"] == "pending", "Metadata correction did not return to review");
        ensure!(resubmitted["name"] == "Updated project" && resubmitted["purpose"] == "Updated purpose", "Metadata corrections were not stored");
        ensure!(resubmitted["source_commit"] == "a".repeat(40), "Metadata corrections changed the presented commit");
        ensure!(resubmitted["repo_url"] == p["repo_url"] && resubmitted["branch"] == p["branch"], "Metadata corrections changed the source");
        ensure!(resubmitted["correction_fields"] == json!([]) && resubmitted["review_note"].is_null(), "Resubmission retained obsolete correction fields");
        self.request(Method::POST, &review, admin_token,
            json!({"decision":"corrections", "note":"Check source", "correction_fields":["branch"]}), StatusCode::OK).await?;
        self.request(Method::POST, &format!("{route}/resubmit"), &owner_token,
            json!({"branch":"main"}), StatusCode::BAD_REQUEST).await?;
        let still_corrections = self.request(Method::GET, &route, &owner_token, Value::Null, StatusCode::OK).await?;
        ensure!(still_corrections["status"] == "corrections", "Source validation failed but the project was resubmitted");
        sqlx::query("UPDATE projects SET status='pending' WHERE id=$1")
            .bind(project).execute(&self.db).await?;
        let p = self.request(Method::POST, &review, admin_token, json!({"decision":"approve"}), StatusCode::OK).await?;
        ensure!(
            p["status"] == "approved" && p["adaptation_report"].is_null(),
            "Approval must succeed without a prebuilt image"
        );
        ensure!(p["correction_fields"] == json!([]), "Approval retained obsolete correction fields");
        let cleared: Option<String> =
            sqlx::query_scalar("SELECT approved_image FROM projects WHERE id=$1")
                .bind(project)
                .fetch_one(&self.db)
                .await?;
        ensure!(cleared.is_none(), "Stale image persisted in PostgreSQL");
        let admitted: bool = sqlx::query_scalar("SELECT registration_approved_at IS NOT NULL FROM projects WHERE id=$1")
            .bind(project).fetch_one(&self.db).await?;
        ensure!(admitted, "Administrative approval was not recorded");
        let builds: i64 = sqlx::query_scalar("SELECT count(*) FROM builds WHERE project_id=$1")
            .bind(project).fetch_one(&self.db).await?;
        ensure!(builds == 0, "The review handler built the application prematurely");
        self.request(Method::POST, &review, admin_token, json!({"decision":"approve"}), StatusCode::CONFLICT).await?;
        self.request(Method::DELETE, &route, &other_token, Value::Null, StatusCode::NOT_FOUND).await?;
        sqlx::query("UPDATE projects SET status='building' WHERE id=$1").bind(project).execute(&self.db).await?;
        self.request(Method::DELETE, &route, &owner_token, Value::Null, StatusCode::CONFLICT).await?;
        sqlx::query("UPDATE projects SET status='running' WHERE id=$1").bind(project).execute(&self.db).await?;
        let deletion = self.request(Method::DELETE, &route, &owner_token, Value::Null, StatusCode::ACCEPTED).await?;
        ensure!(deletion["deleted"] == false, "Deletion was reported as complete before resource verification");
        let visible = self.request(Method::GET, &route, &owner_token, Value::Null, StatusCode::OK).await?;
        ensure!(visible["status"] == "running" && visible["deletion_requested_at"].is_string(), "Queued deletion hid the project prematurely");
        sqlx::query("UPDATE projects SET deletion_error='Registry unavailable' WHERE id=$1").bind(project).execute(&self.db).await?;
        self.request(Method::DELETE, &format!("/admin/projects/{project}"), admin_token, Value::Null, StatusCode::ACCEPTED).await?;
        let visible = self.request(Method::GET, &route, &owner_token, Value::Null, StatusCode::OK).await?;
        ensure!(visible["deletion_error"].is_null(), "Retry did not clear the previous deletion failure");
        Ok(())
    }
}

#[tokio::test]
#[ignore = "requires an isolated ATLAS_TEST_DATABASE_URL and Redis; executed by Actions"]
async fn real_http_and_client_integration() -> Result<()> {
    let database = std::env::var("ATLAS_TEST_DATABASE_URL")
        .context("Set ATLAS_TEST_DATABASE_URL to an isolated test database")?;
    let parsed = reqwest::Url::parse(&database)?;
    ensure!(
        parsed
            .path()
            .trim_start_matches('/')
            .starts_with("atlas_test_"),
        "Database name must start with atlas_test_"
    );
    let db = PgPool::connect(&database).await?;
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    let mut server = Server(
        Command::new(env!("CARGO_BIN_EXE_kubero-wrapper"))
            .env("DATABASE_URL", &database)
            .env(
                "REDIS_URL",
                std::env::var("ATLAS_TEST_REDIS_URL")
                    .unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
            )
            .env("HOST", "127.0.0.1")
            .env("PORT", port.to_string())
            .env("JWT_SECRET", "integration-test-only-secret")
            .env("KUBERNETES_REQUIRED", "false")
            .env("KUBE_CONFIG_PATH", "/nonexistent-atlas-test-kubeconfig")
            .env("GITHUB_APP_ID", "")
            .env("GITHUB_APP_SLUG", "")
            .env("GITHUB_CLIENT_ID", "")
            .env("GITHUB_CLIENT_SECRET", "")
            .env("KUBECONFIG", "/nonexistent-atlas-test-kubeconfig")
            .env_remove("KUBERNETES_SERVICE_HOST")
            .env_remove("KUBERNETES_SERVICE_PORT")
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()?,
    );
    let http = Client::builder().timeout(Duration::from_secs(10)).build()?;
    let base = format!("http://127.0.0.1:{port}/api");
    let mut ready = false;
    for _ in 0..150 {
        ensure!(
            server.0.try_wait()?.is_none(),
            "Backend exited before becoming healthy"
        );
        if let Ok(response) = http.get(format!("{base}/health")).send().await {
            if let Ok(value) = response.json::<Value>().await {
                if value["status"] == "ok" {
                    ready = true;
                    break;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    ensure!(ready, "Backend did not become healthy");
    let mut fixture = Fixture {
        http,
        base,
        db,
        users: vec![],
    };
    let result = fixture.checks().await;
    for id in &fixture.users {
        sqlx::query("DELETE FROM users WHERE id=$1")
            .bind(id)
            .execute(&fixture.db)
            .await?;
    }
    result?;
    if std::env::var("ATLAS_TEST_CLIENT").as_deref() == Ok("1") {
        let email = format!("atlas-client-test-{}@example.invalid", Uuid::new_v4());
        let client_result = Command::new("node")
            .current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../frontend"))
            .args(["--test", "tests/api.integration.cjs"])
            .env("ATLAS_TEST_BACKEND_URL", format!("http://127.0.0.1:{port}"))
            .env("ATLAS_TEST_CLIENT_EMAIL", &email)
            .status();
        sqlx::query("DELETE FROM users WHERE email=$1")
            .bind(email)
            .execute(&fixture.db)
            .await?;
        ensure!(
            client_result?.success(),
            "TypeScript client integration failed"
        );
    }
    Ok(())
}
