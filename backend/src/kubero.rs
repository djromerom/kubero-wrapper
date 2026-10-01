use k8s_openapi::api::apps::v1::Deployment;
use k8s_openapi::api::core::v1::{Event as K8sEvent, Node, Pod};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use kube::{
    api::{Api, ListParams, Patch, PatchParams, PostParams},
    config::{KubeConfigOptions, Kubeconfig},
    Client, Config as KubeConfig, CustomResource,
};
use serde::{Deserialize, Serialize};
use schemars::JsonSchema;

use crate::{
    error::AppResult,
    models::ClusterStatus,
};

#[derive(CustomResource, Deserialize, Serialize, Clone, Debug, JsonSchema)]
#[kube(group = "application.kubero.dev")]
#[kube(version = "v1alpha1")]
#[kube(kind = "KuberoPipeline")]
#[kube(plural = "kuberopipelines")]
#[kube(namespaced)]
#[kube(status = "KuberoPipelineStatus")]
pub struct KuberoPipelineSpec {
    #[serde(default)]
    pub affinity: serde_json::Value,
    #[serde(default)]
    pub autoscaling: serde_json::Value,
    #[serde(default)]
    pub image: serde_json::Value,
    #[serde(default)]
    pub ingress: serde_json::Value,
    #[serde(default)]
    pub replica_count: i32,
    #[serde(default)]
    pub resources: serde_json::Value,
    #[serde(default)]
    pub service: serde_json::Value,
}

#[derive(Deserialize, Serialize, Clone, Debug, JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct KuberoPipelineStatus {
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub conditions: Vec<serde_json::Value>,
    #[serde(default)]
    pub replicas: i32,
    #[serde(default)]
    pub available_replicas: i32,
    #[serde(default)]
    pub updated_replicas: i32,
}

#[derive(CustomResource, Deserialize, Serialize, Clone, Debug, JsonSchema)]
#[kube(group = "application.kubero.dev")]
#[kube(version = "v1alpha1")]
#[kube(kind = "KuberoApp")]
#[kube(plural = "kuberoapps")]
#[kube(namespaced)]
#[kube(status = "KuberoAppStatus")]
pub struct KuberoAppSpec {
    #[serde(default)]
    pub deploymentstrategy: String,
    #[serde(default)]
    pub buildstrategy: String,
    #[serde(default)]
    pub gitrepo: GitRepo,
    #[serde(default)]
    pub image: serde_json::Value,
    #[serde(default)]
    pub branch: String,
    #[serde(default)]
    pub pipeline: String,
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub ingress: serde_json::Value,
    #[serde(default)]
    pub env_vars: Vec<EnvVar>,
    #[serde(default)]
    pub podsize: serde_json::Value,
    #[serde(default)]
    pub replica_count: i32,
    #[serde(default)]
    pub service: serde_json::Value,
    #[serde(default)]
    pub autodeploy: bool,
}

#[derive(Deserialize, Serialize, Clone, Debug, JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct KuberoAppStatus {
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub conditions: Vec<serde_json::Value>,
    #[serde(default)]
    pub replicas: i32,
    #[serde(default)]
    pub available_replicas: i32,
    #[serde(default)]
    pub updated_replicas: i32,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Debug, Default, JsonSchema)]
pub struct GitRepo {
    #[serde(default)]
    pub admin: bool,
    #[serde(default)]
    pub ssh_url: String,
    #[serde(default)]
    pub clone_url: String,
}

#[derive(Deserialize, Serialize, Clone, Debug, JsonSchema)]
pub struct EnvVar {
    pub name: String,
    pub value: String,
}

#[derive(Clone)]
pub struct KuberoManager {
    client: Client,
}

impl KuberoManager {
    pub async fn new(kube_config_path: &str) -> AppResult<Self> {
        let kubeconfig = Kubeconfig::read_from(kube_config_path)
            .map_err(|error| crate::error::AppError::Internal(error.to_string()))?;
        let config = KubeConfig::from_custom_kubeconfig(
            kubeconfig,
            &KubeConfigOptions::default(),
        )
        .await
        .map_err(|error| crate::error::AppError::Internal(error.to_string()))?;
        let client = Client::try_from(config)?;
        Ok(Self { client })
    }

    pub async fn new_in_cluster() -> AppResult<Self> {
        let client = Client::try_default().await?;
        Ok(Self { client })
    }

    pub async fn get_cluster_status(&self) -> AppResult<ClusterStatus> {
        let nodes = Api::<Node>::all(self.client.clone())
            .list(&ListParams::default())
            .await?;

        let pods = Api::<Pod>::all(self.client.clone())
            .list(&ListParams::default())
            .await?;

        Ok(ClusterStatus {
            nodes: nodes.items.len(),
            pods: pods.items.len(),
            cpu_usage: 0.0,
            memory_usage: 0.0,
        })
    }

    pub async fn create_pipeline_crd(
        &self,
        namespace: &str,
        project_slug: &str,
        _repo_url: &str,
        _branch: &str,
        domain: &str,
    ) -> AppResult<String> {
        let pipeline_name = format!("{}-pipeline", project_slug);
        
        let pipeline = KuberoPipeline {
            metadata: ObjectMeta {
                name: Some(pipeline_name.clone()),
                namespace: Some(namespace.to_string()),
                ..Default::default()
            },
            spec: KuberoPipelineSpec {
                affinity: serde_json::json!({}),
                autoscaling: serde_json::json!({
                    "enabled": false,
                    "maxReplicas": 100,
                    "minReplicas": 1,
                    "targetCPUUtilizationPercentage": 80
                }),
                image: serde_json::json!({
                    "pullPolicy": "IfNotPresent",
                    "repository": "nginx",
                    "tag": ""
                }),
                ingress: serde_json::json!({
                    "enabled": true,
                    "className": "",
                    "annotations": {},
                    "hosts": vec![serde_json::json!({
                        "host": domain,
                        "paths": vec![serde_json::json!({
                            "path": "/",
                            "pathType": "ImplementationSpecific"
                        })]
                    })],
                    "tls": []
                }),
                replica_count: 1,
                resources: serde_json::json!({}),
                service: serde_json::json!({
                    "port": 80,
                    "type": "ClusterIP"
                }),
            },
            status: None,
        };

        let api: Api<KuberoPipeline> = Api::namespaced(self.client.clone(), namespace);
        let pp = PostParams::default();
        
        api.create(&pp, &pipeline).await
            .map_err(|e| crate::error::AppError::Internal(format!("Failed to create KuberoPipeline: {}", e)))?;
        
        Ok(pipeline_name)
    }

    pub async fn create_app_crd(
        &self,
        namespace: &str,
        project_slug: &str,
        repo_url: &str,
        branch: &str,
        pipeline_name: &str,
        domain: &str,
        registry_url: &str,
    ) -> AppResult<String> {
        let app_name = format!("{}-app", project_slug);
        
        // Parse repo URL to get owner/repo
        let repo_path = repo_url
            .trim()
            .strip_prefix("https://github.com/")
            .ok_or_else(|| crate::error::AppError::BadRequest("Repository must be a GitHub HTTPS URL".into()))?
            .trim_end_matches('/')
            .trim_end_matches(".git");
        
        let app = KuberoApp {
            metadata: ObjectMeta {
                name: Some(app_name.clone()),
                namespace: Some(namespace.to_string()),
                ..Default::default()
            },
            spec: KuberoAppSpec {
                deploymentstrategy: "git".to_string(),
                buildstrategy: "dockerfile".to_string(),
                gitrepo: GitRepo {
                    admin: false,
                    ssh_url: format!("git@github.com:{}.git", repo_path),
                    clone_url: repo_url.to_string(),
                },
                image: serde_json::json!({
                    "repository": format!("{}/{}", registry_url, project_slug),
                    "tag": branch,
                    "pullPolicy": "Always",
                    "containerPort": 3000
                }),
                branch: branch.to_string(),
                pipeline: pipeline_name.to_string(),
                phase: "production".to_string(),
                name: app_name.clone(),
                ingress: serde_json::json!({
                    "enabled": true,
                    "className": "",
                    "annotations": {},
                    "hosts": vec![serde_json::json!({
                        "host": domain,
                        "paths": vec![serde_json::json!({
                            "path": "/",
                            "pathType": "ImplementationSpecific"
                        })]
                    })],
                    "tls": []
                }),
                env_vars: vec![],
                podsize: serde_json::json!({
                    "default": true,
                    "description": "Small (CPU: 0.25, Memory: 0.5Gi)",
                    "name": "small",
                    "resources": {
                        "limits": {
                            "cpu": "500m",
                            "memory": "1Gi"
                        },
                        "requests": {
                            "cpu": "250m",
                            "memory": "0.5Gi"
                        }
                    }
                }),
                replica_count: 1,
                service: serde_json::json!({
                    "port": 80,
                    "type": "ClusterIP"
                }),
                autodeploy: true,
            },
            status: None,
        };

        let api: Api<KuberoApp> = Api::namespaced(self.client.clone(), namespace);
        let pp = PostParams::default();
        
        api.create(&pp, &app).await
            .map_err(|e| crate::error::AppError::Internal(format!("Failed to create KuberoApp: {}", e)))?;
        
        Ok(app_name)
    }

    pub async fn delete_pipeline_crd(&self, namespace: &str, pipeline_name: &str) -> AppResult<()> {
        let api: Api<KuberoPipeline> = Api::namespaced(self.client.clone(), namespace);
        api.delete(pipeline_name, &Default::default()).await
            .map_err(|e| crate::error::AppError::Internal(format!("Failed to delete KuberoPipeline: {}", e)))?;
        Ok(())
    }

    pub async fn delete_app_crd(&self, namespace: &str, app_name: &str) -> AppResult<()> {
        let api: Api<KuberoApp> = Api::namespaced(self.client.clone(), namespace);
        api.delete(app_name, &Default::default()).await
            .map_err(|e| crate::error::AppError::Internal(format!("Failed to delete KuberoApp: {}", e)))?;
        Ok(())
    }

    pub async fn trigger_build(&self, namespace: &str, app_name: &str) -> AppResult<String> {
        // Trigger build by patching the KuberoApp with an annotation
        let api: Api<KuberoApp> = Api::namespaced(self.client.clone(), namespace);
        let patch = serde_json::json!({
            "metadata": {
                "annotations": {
                    "kubero.dev/build-trigger": chrono::Utc::now().to_rfc3339()
                }
            }
        });
        
        let pp = PatchParams::apply("kubero-wrapper");
        api.patch(app_name, &pp, &Patch::Apply(patch)).await
            .map_err(|e| crate::error::AppError::Internal(format!("Failed to trigger build: {}", e)))?;
        
        Ok(format!("Build triggered for {}", app_name))
    }

    pub async fn get_app_status(&self, namespace: &str, app_name: &str) -> AppResult<serde_json::Value> {
        let api: Api<KuberoApp> = Api::namespaced(self.client.clone(), namespace);
        let app = api.get(app_name).await
            .map_err(|e| crate::error::AppError::Internal(format!("Failed to get KuberoApp: {}", e)))?;
        
        // Read actual Deployments created by Kubero
        let deployments_api: Api<Deployment> = Api::namespaced(self.client.clone(), namespace);
        
        let web_deployment_name = format!("{}-kuberoapp-web", app_name);
        let worker_deployment_name = format!("{}-kuberoapp-worker", app_name);
        
        let web_deployment = deployments_api.get(&web_deployment_name).await.ok();
        let worker_deployment = deployments_api.get(&worker_deployment_name).await.ok();
        
        // Aggregate replica counts from both deployments
        let total_replicas = web_deployment.as_ref()
            .and_then(|d| d.status.as_ref())
            .and_then(|s| s.replicas)
            .unwrap_or(0)
            + worker_deployment.as_ref()
            .and_then(|d| d.status.as_ref())
            .and_then(|s| s.replicas)
            .unwrap_or(0);
        
        let total_available = web_deployment.as_ref()
            .and_then(|d| d.status.as_ref())
            .and_then(|s| s.available_replicas)
            .unwrap_or(0)
            + worker_deployment.as_ref()
            .and_then(|d| d.status.as_ref())
            .and_then(|s| s.available_replicas)
            .unwrap_or(0);
        
        let total_ready = web_deployment.as_ref()
            .and_then(|d| d.status.as_ref())
            .and_then(|s| s.ready_replicas)
            .unwrap_or(0)
            + worker_deployment.as_ref()
            .and_then(|d| d.status.as_ref())
            .and_then(|s| s.ready_replicas)
            .unwrap_or(0);
        
        // Extract conditions from KuberoApp status
        let conditions = app.status.as_ref()
            .and_then(|s| if s.conditions.is_empty() { None } else { Some(&s.conditions) })
            .map(|c| serde_json::to_value(c).unwrap_or(serde_json::json!([])))
            .unwrap_or(serde_json::json!([]));

        // Determine phase from conditions
        let phase = if total_available >= total_replicas && total_replicas > 0 {
            "Running".to_string()
        } else if total_replicas > 0 {
            "Building".to_string()
        } else {
            "Pending".to_string()
        };

        Ok(serde_json::json!({
            "name": app_name,
            "namespace": namespace,
            "status": {
                "phase": phase,
                "conditions": conditions,
                "replicas": total_replicas,
                "availableReplicas": total_available,
                "readyReplicas": total_ready,
                "url": app.status.as_ref().and_then(|s| {
                    // Try to extract URL from deployedRelease message if available
                    s.conditions.iter()
                        .find(|c| c.get("type").and_then(|t| t.as_str()) == Some("Deployed"))
                        .and_then(|c| c.get("message"))
                        .and_then(|m| m.as_str())
                        .and_then(|msg| {
                            // Extract URL from message like "http://num300.app.estudiantes.cluster.local/"
                            msg.lines()
                                .find(|line| line.starts_with("http://") || line.starts_with("https://"))
                                .map(|url| url.trim().to_string())
                        })
                }),
            },
            "ingress": app.spec.ingress,
        }))
    }

    pub async fn get_app_events(&self, namespace: &str, app_name: &str) -> AppResult<Vec<serde_json::Value>> {
        let events_api: Api<K8sEvent> = Api::namespaced(self.client.clone(), namespace);
        
        // Get all Pod events in the namespace (Kubernetes doesn't support regex in field selectors)
        let lp = ListParams::default()
            .fields("involvedObject.kind=Pod")
            .limit(100);
        
        let events = events_api.list(&lp).await
            .map_err(|e| crate::error::AppError::Internal(format!("Failed to get events: {}", e)))?;
        
        // Filter in Rust: only events for pods belonging to this app (name starts with {app_name}-kuberoapp)
        let app_events: Vec<_> = events.items.into_iter()
            .filter(|event| {
                event.involved_object
                    .name
                    .as_ref()
                    .map(|name| name.starts_with(&format!("{}-kuberoapp", app_name)))
                    .unwrap_or(false)
            })
            .collect();
        
        // Sort by last_timestamp, most recent first
        let mut sorted_events = app_events;
        sorted_events.sort_by(|a, b| {
            match (&b.last_timestamp, &a.last_timestamp) {
                (Some(bt), Some(at)) => bt.cmp(at),
                (Some(_), None) => std::cmp::Ordering::Greater,
                (None, Some(_)) => std::cmp::Ordering::Less,
                (None, None) => std::cmp::Ordering::Equal,
            }
        });
        
        // Take only the 20 most recent
        let event_list = sorted_events.into_iter().take(20).map(|event| {
            serde_json::json!({
                "type": event.type_,
                "reason": event.reason,
                "message": event.message,
                "first_timestamp": event.first_timestamp,
                "last_timestamp": event.last_timestamp,
                "count": event.count,
            })
        }).collect();
        
        Ok(event_list)
    }
}
