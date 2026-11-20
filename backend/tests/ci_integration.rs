//! All external HTTP traffic is served on loopback. Never uses real GitHub / CI / NAS.
use anyhow::{ensure, Context, Result};
use axum::{body::{to_bytes, Body}, extract::State, http::{Request, StatusCode}, response::{IntoResponse, Response}, Router};
use reqwest::Client;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::{process::{Child, Command, Stdio}, sync::{Arc, Mutex}, time::Duration};
use uuid::Uuid;

const INTERNAL_TOKEN: &str = "mock-internal-authorization-token-32-characters";
const PUBLICATION_TOKEN: &str = "mock-isolated-publication-token-32-characters";
const SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
#[derive(Default)]
struct Remote {
    pipelines: Vec<Value>,
    posts: usize,
    mode: String,
    registry_bad: bool,
    registry_missing: bool,
    registry_wrong_arch: bool,
    commit_reads: usize,
    backend: String,
    authorization_checks: usize,
    registry_checks: usize,
    publication_checks: usize,
}
type Shared = Arc<Mutex<Remote>>;
fn digest(bytes: &[u8]) -> String { format!("sha256:{:x}",Sha256::digest(bytes)) }
fn json_response(value: Value) -> Response { axum::Json(value).into_response() }
fn registry_response(bytes: Vec<u8>, bad: bool) -> Response {
    let hash = if bad { format!("sha256:{}","b".repeat(64)) } else { digest(&bytes) };
    ([ ("content-type","application/vnd.oci.image.manifest.v1+json"), ("docker-content-digest",&hash) ],bytes).into_response()
}
async fn mock(State(state): State<Shared>, request: Request<Body>) -> Response {
    let path = request.uri().path().to_string();
    let query = request.uri().query().unwrap_or("").to_string();
    let method = request.method().to_string();
    let auth = request.headers().get("authorization").and_then(|v|v.to_str().ok()).unwrap_or("").to_string();
    if path.starts_with("/user/") || path.starts_with("/repos/") {
        if auth != "Bearer mock-user-github" { return StatusCode::UNAUTHORIZED.into_response(); }
        if path == "/user/installations" { return json_response(json!({"installations":[{"id":8,"app_id":7}]})); }
        if path == "/user/installations/8/repositories" {
            // The real target is only on page 2, and is owned by an organization.
            let repos: Vec<Value> = if query.contains("page=2") { vec![json!({"id":1001,"full_name":"team/app","owner":{"login":"team"},"html_url":"https://github.com/team/app"})] }
                else { (0..100).map(|i| json!({"id":i,"full_name":format!("team/dummy-{i}")})).collect() };
            return json_response(json!({"repositories":repos}));
        }
        if path == "/repos/team/app/branches" { return json_response(json!([{"name":"main"},{"name":"feature/web"}])); }
        if path == "/repos/team/app/commits" {
            let mut remote = state.lock().unwrap();
            remote.commit_reads += 1;
            let sha = if remote.mode == "changed-before-submit" && remote.commit_reads > 1 { "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } else { SHA };
            return json_response(json!([{"sha":sha,"commit":{"message":"fixture"}}]));
        }
    }
    if path.starts_with("/api/") {
        if auth != "Bearer mock-woodpecker-token" { return StatusCode::UNAUTHORIZED.into_response(); }
        if path == "/api/repos/lookup/team/app" { return json_response(json!({"id":11,"full_name":"team/app","active":true,"forge_url":"https://github.com/team/app"})); }
        if path == "/api/repos/11/pipelines" && method == "POST" {
            let body: Value = serde_json::from_slice(&to_bytes(request.into_body(),16384).await.unwrap()).unwrap();
            assert_eq!(body["variables"].as_object().unwrap().len(),4, "Do not forward secrets to pipelines");
            assert_eq!(body["variables"]["ATLAS_PLATFORM"],"linux/arm64");
            let id = body["variables"]["ATLAS_RUN_ID"].as_str().unwrap();
            let backend = state.lock().unwrap().backend.clone();
            let authorization = Client::new().get(format!("{backend}/internal/ci/runs/{id}/authorization"))
                .bearer_auth(INTERNAL_TOKEN).send().await.unwrap();
            assert_eq!(authorization.status(),reqwest::StatusCode::OK);
            let authorized: Value = authorization.json().await.unwrap();
            assert_eq!(authorized["contract_version"],2);
            assert_eq!(authorized["purpose"],"configuration");
            assert_eq!(authorized["commit_sha"], SHA);
            assert_eq!(authorized["woodpecker_repo_id"],11);
            assert_eq!(authorized["event"],"manual");
            assert!(body["variables"]["ATLAS_IMAGE"].as_str().unwrap().ends_with(&format!("/{}:{}",authorized["image_repository"].as_str().unwrap(),id)));
            let (p, mode) = {
                let mut remote = state.lock().unwrap();
                remote.posts += 1;
                remote.authorization_checks += 1;
                let n = remote.posts;
                let sha = if remote.mode == "mismatch" { "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } else { SHA };
                let p = json!({"id":100+n,"number":n,"author":if remote.mode=="wrong-author" {"attacker"} else {"atlas-service"},"branch":body["branch"],"commit":sha,"event":"manual",
                    "message":format!("MANUAL: {} @ {}",body["message"].as_str().unwrap(),body["branch"].as_str().unwrap()),
                    "status":if remote.mode=="failure" {"failure"} else {"pending"}});
                remote.pipelines.push(p.clone());
                (p, remote.mode.clone())
            };
            if mode == "lost" { return StatusCode::BAD_GATEWAY.into_response(); }
            if mode == "timeout" { tokio::time::sleep(Duration::from_secs(3)).await; }
            return json_response(p);
        }
        if path == "/api/repos/11/pipelines" { return json_response(json!(state.lock().unwrap().pipelines)); }
        if let Some(number) = path.strip_prefix("/api/repos/11/pipelines/").and_then(|n|n.parse::<usize>().ok()) {
            let (p, backend, publish) = {
                let mut remote = state.lock().unwrap();
                let backend = remote.backend.clone();
                let p = &mut remote.pipelines[number-1];
                let publish = p["status"] == "running";
                p["status"] = match p["status"].as_str().unwrap() { "pending" => json!("running"), "running" => json!("success"), _ => p["status"].clone() };
                (p.clone(), backend, publish)
            };
            if publish {
                let id = p["message"].as_str().unwrap().strip_prefix("MANUAL: atlas:").unwrap().split(" @ ").next().unwrap();
                let response = Client::new().get(format!("{backend}/internal/ci/runs/{id}/authorization?purpose=publication"))
                    .bearer_auth(PUBLICATION_TOKEN).send().await.unwrap();
                assert_eq!(response.status(),reqwest::StatusCode::OK);
                let grant: Value = response.json().await.unwrap();
                assert_eq!(grant["pipeline_id"],p["id"]);
                assert_eq!(grant["pipeline_number"],p["number"]);
                assert_eq!(grant["commit_sha"],p["commit"]);
                assert_eq!(grant["expected_author"],p["author"]);
                assert_eq!(grant["purpose"],"publication");
                state.lock().unwrap().publication_checks += 1;
            }
            return json_response(p);
        }
    }
    if path.starts_with("/v2/") {
        if auth != "Bearer mock-registry-read-only" { return StatusCode::UNAUTHORIZED.into_response(); }
        let arch = if state.lock().unwrap().registry_wrong_arch { "amd64" } else { "arm64" };
        let config = serde_json::to_vec(&json!({"architecture":arch,"os":"linux"})).unwrap();
        let hash = digest(&config);
        let mut remote = state.lock().unwrap();
        remote.registry_checks += 1;
        if remote.registry_missing { return StatusCode::NOT_FOUND.into_response(); }
        if path.contains("/manifests/") {
            let body = serde_json::to_vec(&json!({"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json",
                "config":{"digest":hash,"size":config.len(),"mediaType":"application/vnd.oci.image.config.v1+json"},"layers":[]})).unwrap();
            return registry_response(body,remote.registry_bad);
        }
        if path.ends_with(&format!("/blobs/{hash}")) { return config.into_response(); }
    }
    StatusCode::NOT_FOUND.into_response()
}

struct Server(Child);
impl Drop for Server { fn drop(&mut self) { let _=self.0.kill(); let _=self.0.wait(); } }
async fn wait_status(client: &Client, base: &str, token: &str, id: &str, expected: &str) -> Result<Value> {
    for _ in 0..120 {
        let value: Value = client.get(format!("{base}/projects/{id}")).bearer_auth(token).send().await?.json().await?;
        if value["ci"]["status"] == expected { return Ok(value); }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    anyhow::bail!("CI did not reach {expected}")
}
async fn register(client: &Client, base: &str) -> Result<Value> {
    Ok(client.post(format!("{base}/auth/register")).json(&json!({"name":"CI integration","email":format!("{}@example.invalid",Uuid::new_v4()),"password":"isolated-test-password"}))
        .send().await?.error_for_status()?.json().await?)
}
fn project_body() -> Value { let id=Uuid::new_v4(); json!({"request_id":id,"name":format!("CI {}",&id.to_string()[..8]),"repo_url":"https://github.com/team/app","branch":"main","purpose":"CI mock test"}) }

// Freeze polling for this fixture; all policy decisions still traverse the real HTTP handler and DB.
async fn authorization_matrix(client: &Client, base: &str, db: &PgPool, project: &str, user_token: &str) -> Result<()> {
    let project = Uuid::parse_str(project)?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO ci_runs(id,project_id,repo_url,branch,commit_sha,status,mode,image_tag,image_repository,woodpecker_repo_id,pipeline_id,pipeline_number,submitted_at,authorization_expires_at,woodpecker_url,registry_url,expected_author,next_poll_at) SELECT $1,project_id,repo_url,branch,commit_sha,'running',mode,$1::text,image_repository,woodpecker_repo_id,9001,9001,NOW()-interval '1 minute',NOW()+interval '1 hour',woodpecker_url,registry_url,expected_author,'infinity' FROM ci_runs WHERE project_id=$2 AND status='published' LIMIT 1")
        .bind(id).bind(project).execute(db).await?;
    let url = format!("{base}/internal/ci/runs/{id}/authorization");
    for (purpose, secret) in [("configuration", INTERNAL_TOKEN), ("publication", PUBLICATION_TOKEN)] {
        let response=client.get(&url).query(&[("purpose",purpose)]).bearer_auth(secret).send().await?;
        ensure!(response.status()==reqwest::StatusCode::OK,"valid {purpose} rejected");
        ensure!(response.headers().get("cache-control").unwrap()=="no-store","authorization cached");
        let body=response.text().await?;
        ensure!(!body.contains(INTERNAL_TOKEN) && !body.contains(PUBLICATION_TOKEN) && !body.contains("mock-registry"),"secret disclosed");
    }
    for (purpose, secret) in [("configuration",PUBLICATION_TOKEN),("publication",INTERNAL_TOKEN),("publication",user_token),("configuration",""),("configuration","wrong"),("unknown",INTERNAL_TOKEN)] {
        ensure!(client.get(&url).query(&[("purpose",purpose)]).bearer_auth(secret).send().await?.status()==reqwest::StatusCode::UNAUTHORIZED,"scope/token bypass");
    }
    for path in ["not-a-uuid".to_string(), Uuid::new_v4().to_string()] {
        let unknown=format!("{base}/internal/ci/runs/{path}/authorization");
        ensure!(client.get(&unknown).send().await?.status()==reqwest::StatusCode::UNAUTHORIZED,"unauthenticated identity leak");
        ensure!(client.get(&unknown).bearer_auth(INTERNAL_TOKEN).send().await?.status()==reqwest::StatusCode::NOT_FOUND,"unknown run not rejected");
    }
    for status in ["queued","blocked","submission_unknown","published","failed","cancelled"] {
        sqlx::query("UPDATE ci_runs SET status=$2 WHERE id=$1").bind(id).bind(status).execute(db).await?;
        for (purpose, secret) in [("configuration",INTERNAL_TOKEN),("publication",PUBLICATION_TOKEN)] {
            ensure!(client.get(&url).query(&[("purpose",purpose)]).bearer_auth(secret).send().await?.status()==reqwest::StatusCode::CONFLICT,"{status} authorized");
        }
    }
    sqlx::query("UPDATE ci_runs SET status='submitting',pipeline_id=NULL,pipeline_number=NULL WHERE id=$1").bind(id).execute(db).await?;
    ensure!(client.get(&url).bearer_auth(INTERNAL_TOKEN).send().await?.status()==reqwest::StatusCode::OK,"pre-submit configuration rejected");
    ensure!(client.get(&url).query(&[("purpose","publication")]).bearer_auth(PUBLICATION_TOKEN).send().await?.status()==reqwest::StatusCode::CONFLICT,"unbound publication allowed");
    sqlx::query("UPDATE ci_runs SET status='running',pipeline_id=9001,pipeline_number=9001 WHERE id=$1").bind(id).execute(db).await?;
    // Mutations are fixed SQL literals, never input. Restore every field after each rejection.
    for (mutation, restore) in [
        ("authorization_expires_at=NOW()", "authorization_expires_at=NOW()+interval '1 hour'"),
        ("authorization_expires_at=NULL", "authorization_expires_at=NOW()+interval '1 hour'"),
        ("submitted_at=NOW()+interval '1 minute'", "submitted_at=NOW()-interval '1 minute'"),
        ("submitted_at=NULL", "submitted_at=NOW()-interval '1 minute'"),
        ("completed_at=NOW()", "completed_at=NULL"),
        ("woodpecker_repo_id=0", "woodpecker_repo_id=11"),
        ("woodpecker_url='https://different.invalid'", "woodpecker_url=(SELECT woodpecker_url FROM ci_runs WHERE project_id=$2 AND status='published' LIMIT 1)"),
        ("registry_url='https://different.invalid'", "registry_url=(SELECT registry_url FROM ci_runs WHERE project_id=$2 AND status='published' LIMIT 1)"),
        ("expected_author='attacker'", "expected_author='atlas-service'"),
        ("image_repository='other/target'", "image_repository='atlas/' || project_id::text"),
        ("image_tag='other'", "image_tag=id::text"),
        ("platform='linux/amd64'", "platform='linux/arm64'"),
    ] {
        sqlx::query(&format!("UPDATE ci_runs SET {mutation} WHERE id=$1 AND project_id=$2")).bind(id).bind(project).execute(db).await?;
        for (purpose, secret) in [("configuration",INTERNAL_TOKEN),("publication",PUBLICATION_TOKEN)] {
            ensure!(client.get(&url).query(&[("purpose",purpose)]).bearer_auth(secret).send().await?.status()==reqwest::StatusCode::CONFLICT,"invalid context authorized: {mutation}");
        }
        sqlx::query(&format!("UPDATE ci_runs SET {restore} WHERE id=$1 AND project_id=$2")).bind(id).bind(project).execute(db).await?;
    }
    for mutation in ["pipeline_id=NULL", "pipeline_number=0"] {
        sqlx::query(&format!("UPDATE ci_runs SET {mutation} WHERE id=$1")).bind(id).execute(db).await?;
        ensure!(client.get(&url).query(&[("purpose","publication")]).bearer_auth(PUBLICATION_TOKEN).send().await?.status()==reqwest::StatusCode::CONFLICT,"missing pipeline identity accepted");
        sqlx::query("UPDATE ci_runs SET pipeline_id=9001,pipeline_number=9001 WHERE id=$1").bind(id).execute(db).await?;
    }
    sqlx::query("UPDATE projects SET deletion_requested_at=NOW() WHERE id=$1").bind(project).execute(db).await?;
    ensure!(client.get(&url).bearer_auth(INTERNAL_TOKEN).send().await?.status()==reqwest::StatusCode::NOT_FOUND,"archiving project authorized");
    sqlx::query("UPDATE projects SET deletion_requested_at=NULL WHERE id=$1").bind(project).execute(db).await?;
    sqlx::query("DELETE FROM ci_runs WHERE id=$1").bind(id).execute(db).await?;
    Ok(())
}

#[test]
fn offline_configuration_check_never_connects_or_enables_ci() -> Result<()> {
    let run = |enabled: &str| Command::new(env!("CARGO_BIN_EXE_kubero-wrapper"))
        .arg("--check-ci-config").env_clear()
        .env("ATLAS_CI_ENABLED",enabled).env("WOODPECKER_URL","https://woodpecker.invalid")
        .env("WOODPECKER_TOKEN","mock-token").env("WOODPECKER_EXPECTED_AUTHOR","atlas-service")
        .env("ATLAS_REGISTRY_URL","https://registry.invalid")
        .env("ATLAS_CI_AUTHORIZATION_TOKEN",INTERNAL_TOKEN).env("ATLAS_CI_PUBLICATION_TOKEN",PUBLICATION_TOKEN)
        .env("DATABASE_URL","postgres://invalid.invalid/never-connect").output();
    let output=run("false")?;
    ensure!(output.status.success(),"offline validation attempted external connectivity or rejected fixture");
    ensure!(!String::from_utf8_lossy(&output.stdout).contains(INTERNAL_TOKEN),"secret printed");
    ensure!(!run("true")?.status.success(),"offline validation accepted CI activation");
    Ok(())
}

#[tokio::test]
#[ignore = "requires isolated ATLAS_TEST_DATABASE_URL; external services are local mocks"]
async fn registration_ci_publication_and_uncertain_request_recovery() -> Result<()> {
    let database = std::env::var("ATLAS_TEST_DATABASE_URL").context("isolated test DB required")?;
    ensure!(reqwest::Url::parse(&database)?.path().starts_with("/atlas_test_"),"test DB required");
    let db = PgPool::connect(&database).await?;
    let shared = Arc::new(Mutex::new(Remote::default()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let remote_url = format!("http://{}",listener.local_addr()?);
    let router = Router::new().fallback(mock).with_state(shared.clone());
    let mock_task = tokio::spawn(async move { axum::serve(listener,router).await.unwrap(); });
    let port_listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let port = port_listener.local_addr()?.port(); drop(port_listener);
    let base = format!("http://127.0.0.1:{port}/api");
    shared.lock().unwrap().backend = base.clone();
    let mut server = Server(Command::new(env!("CARGO_BIN_EXE_kubero-wrapper"))
        .env("DATABASE_URL",&database).env("REDIS_URL",std::env::var("ATLAS_TEST_REDIS_URL").unwrap_or_else(|_|"redis://127.0.0.1:1".into()))
        .env("HOST","127.0.0.1").env("PORT",port.to_string()).env("JWT_SECRET","ci-test-secret")
        .env("GITHUB_API_URL",&remote_url).env("GITHUB_APP_ID","7")
        .env("ATLAS_CI_ENABLED","true").env("ATLAS_CI_CENTRAL_READY","true").env("ATLAS_CI_MODE","central")
        .env("ATLAS_CI_ALLOW_HTTP_LOOPBACK","true").env("ATLAS_CI_POLL_SECONDS","1").env("ATLAS_CI_HTTP_TIMEOUT_SECONDS","1")
        .env("WOODPECKER_URL",&remote_url).env("WOODPECKER_TOKEN","mock-woodpecker-token")
        .env("WOODPECKER_EXPECTED_AUTHOR","atlas-service")
        .env("ATLAS_CI_AUTHORIZATION_TOKEN",INTERNAL_TOKEN).env("ATLAS_REGISTRY_URL",&remote_url)
        .env("ATLAS_CI_PUBLICATION_TOKEN",PUBLICATION_TOKEN)
        .env("ATLAS_REGISTRY_TOKEN","mock-registry-read-only").env("ATLAS_REGISTRY_USERNAME","").env("ATLAS_REGISTRY_PASSWORD","")
        .env("ATLAS_REGISTRY_CA_FILE","").env("ATLAS_REGISTRY_NAMESPACE","atlas")
        .stdout(Stdio::null()).stderr(Stdio::inherit()).spawn()?);
    let client = Client::builder().timeout(Duration::from_secs(10)).build()?;
    for _ in 0..100 {
        ensure!(server.0.try_wait()?.is_none(),"backend exited");
        if client.get(format!("{base}/health")).send().await.is_ok() { break; }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let account = register(&client,&base).await?;
    let owner = Uuid::parse_str(account["user"]["id"].as_str().unwrap())?;
    let token = account["token"].as_str().unwrap();
    let other = register(&client,&base).await?;
    let other_id = Uuid::parse_str(other["user"]["id"].as_str().unwrap())?;
    sqlx::query("INSERT INTO github_accounts(user_id,github_user_id,github_login,access_token) VALUES ($1,7,'student','mock-user-github')").bind(owner).execute(&db).await?;
    let outcome: Result<()> = async {
        let body=project_body();
        let request = || client.post(format!("{base}/projects")).bearer_auth(token).json(&body).send();
        let (a,b)=tokio::join!(request(),request());
        let a=a?; let b=b?;
        ensure!(a.status().is_success() && b.status().is_success(),"idempotent registration failed");
        let a:Value=a.json().await?; let b:Value=b.json().await?;
        ensure!(a["id"]==b["id"],"duplicate project");
        let id=a["id"].as_str().unwrap();
        let denied=client.get(format!("{base}/projects/{id}/ci/runs")).bearer_auth(other["token"].as_str().unwrap()).send().await?;
        ensure!(denied.status()==reqwest::StatusCode::NOT_FOUND,"CI history ownership leak");
        let forbidden=client.get(format!("{base}/internal/ci/runs/{}/authorization",a["ci"]["id"].as_str().unwrap())).bearer_auth(token).send().await?;
        ensure!(forbidden.status()==reqwest::StatusCode::UNAUTHORIZED,"user token authorized publication");
        let mut conflicting=body.clone(); conflicting["purpose"]=json!("changed");
        ensure!(client.post(format!("{base}/projects")).bearer_auth(token).json(&conflicting).send().await?.status()==reqwest::StatusCode::CONFLICT,"key reuse accepted");
        let mut forbidden_repo=project_body(); forbidden_repo["repo_url"]=json!("https://github.com/team/not-authorized");
        ensure!(client.post(format!("{base}/projects")).bearer_auth(token).json(&forbidden_repo).send().await?.status()==reqwest::StatusCode::FORBIDDEN,"repository authorization bypassed");
        let published=wait_status(&client,&base,token,id,"published").await?;
        ensure!(published["status"]=="pending" && published["domain"].is_null(),"CI changed CD state");
        ensure!(published["ci"]["image_digest"].as_str().unwrap().starts_with("sha256:"),"missing digest");
        ensure!(published["ci"]["image_reference"].as_str().unwrap().contains("@sha256:"),"missing immutable image");
        ensure!(shared.lock().unwrap().posts==1,"registration caused duplicate runs");
        // No deployment resources or old build entries were fabricated.
        let legacy: i64=sqlx::query_scalar("SELECT count(*) FROM builds WHERE project_id=$1").bind(Uuid::parse_str(id)?).fetch_one(&db).await?;
        ensure!(legacy==0,"CI wrote legacy CD builds");
        authorization_matrix(&client, &base, &db, id, token).await?;
        for mode in ["lost","timeout"] {
            shared.lock().unwrap().mode=mode.into();
            let p:Value=client.post(format!("{base}/projects")).bearer_auth(token).json(&project_body()).send().await?.error_for_status()?.json().await?;
            wait_status(&client,&base,token,p["id"].as_str().unwrap(),"published").await?;
        }
        ensure!(shared.lock().unwrap().posts==3,"uncertain POST was repeated");
        shared.lock().unwrap().mode="failure".into();
        let failed:Value=client.post(format!("{base}/projects")).bearer_auth(token).json(&project_body()).send().await?.json().await?;
        let fid=failed["id"].as_str().unwrap();
        wait_status(&client,&base,token,fid,"failed").await?;
        shared.lock().unwrap().mode="".into();
        let retry=client.post(format!("{base}/projects/{fid}/ci/retry")).bearer_auth(token).send().await?;
        ensure!(retry.status()==reqwest::StatusCode::NO_CONTENT,"retry rejected");
        ensure!(client.post(format!("{base}/projects/{fid}/ci/retry")).bearer_auth(token).send().await?.status()==reqwest::StatusCode::CONFLICT,"active duplicate accepted");
        wait_status(&client,&base,token,fid,"published").await?;
        shared.lock().unwrap().registry_bad=true;
        let bad:Value=client.post(format!("{base}/projects")).bearer_auth(token).json(&project_body()).send().await?.json().await?;
        let bad=wait_status(&client,&base,token,bad["id"].as_str().unwrap(),"failed").await?;
        ensure!(bad["ci"]["image_digest"].is_null(),"bad digest accepted");
        shared.lock().unwrap().registry_bad=false;
        shared.lock().unwrap().registry_wrong_arch=true;
        let wrong_arch:Value=client.post(format!("{base}/projects")).bearer_auth(token).json(&project_body()).send().await?.json().await?;
        let wrong_arch=wait_status(&client,&base,token,wrong_arch["id"].as_str().unwrap(),"failed").await?;
        ensure!(wrong_arch["ci"]["image_digest"].is_null(),"AMD64 accepted as ARM64");
        shared.lock().unwrap().registry_wrong_arch=false;
        shared.lock().unwrap().registry_missing=true;
        let missing:Value=client.post(format!("{base}/projects")).bearer_auth(token).json(&project_body()).send().await?.json().await?;
        wait_status(&client,&base,token,missing["id"].as_str().unwrap(),"verifying").await?;
        shared.lock().unwrap().registry_missing=false;
        wait_status(&client,&base,token,missing["id"].as_str().unwrap(),"published").await?;
        let posts = shared.lock().unwrap().posts;
        { let mut remote=shared.lock().unwrap(); remote.mode="changed-before-submit".into(); remote.commit_reads=0; }
        let changed:Value=client.post(format!("{base}/projects")).bearer_auth(token).json(&project_body()).send().await?.json().await?;
        wait_status(&client,&base,token,changed["id"].as_str().unwrap(),"failed").await?;
        ensure!(shared.lock().unwrap().posts==posts,"changed commit submitted to CI");
        shared.lock().unwrap().mode="wrong-author".into();
        let author:Value=client.post(format!("{base}/projects")).bearer_auth(token).json(&project_body()).send().await?.json().await?;
        let author=wait_status(&client,&base,token,author["id"].as_str().unwrap(),"submission_unknown").await?;
        ensure!(author["ci"]["image_digest"].is_null(),"untrusted CI author accepted");
        shared.lock().unwrap().mode="mismatch".into();
        let mismatch:Value=client.post(format!("{base}/projects")).bearer_auth(token).json(&project_body()).send().await?.json().await?;
        let mid=mismatch["id"].as_str().unwrap();
        let mismatch=wait_status(&client,&base,token,mid,"submission_unknown").await?;
        ensure!(mismatch["ci"]["image_digest"].is_null(),"wrong commit accepted");
        ensure!(client.post(format!("{base}/projects/{mid}/ci/retry")).bearer_auth(token).send().await?.status()==reqwest::StatusCode::CONFLICT,"uncertain run retried");
        ensure!(client.delete(format!("{base}/projects/{mid}")).bearer_auth(token).send().await?.status()==reqwest::StatusCode::CONFLICT,"inflight run archived");
        let archived:Value=client.delete(format!("{base}/projects/{id}")).bearer_auth(token).send().await?.json().await?;
        ensure!(archived["deleted"]==true,"completed project not archived");
        let retained:i64=sqlx::query_scalar("SELECT count(*) FROM ci_runs WHERE project_id=$1").bind(Uuid::parse_str(id)?).fetch_one(&db).await?;
        ensure!(retained==1,"archive erased history");
        ensure!(shared.lock().unwrap().authorization_checks>0 && shared.lock().unwrap().registry_checks>0 && shared.lock().unwrap().publication_checks>0,"central contract or registry not checked");
        Ok(())
    }.await;
    drop(server);
    sqlx::query("DELETE FROM users WHERE id=ANY($1)").bind(vec![owner,other_id]).execute(&db).await?;
    mock_task.abort();
    outcome
}
