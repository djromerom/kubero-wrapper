use k8s_openapi::api::core::v1::{Node, Pod};
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
        
        // Extract status information from the CRD
        let status = app.status.as_ref().map(|s| {
            serde_json::json!({
                "phase": s.phase,
                "conditions": s.conditions,
                "replicas": s.replicas,
                "availableReplicas": s.available_replicas,
                "updatedReplicas": s.updated_replicas,
                "url": s.url,
            })
        }).unwrap_or_else(|| serde_json::json!({
            "phase": "pending",
            "conditions": [],
            "replicas": 0,
            "availableReplicas": 0,
            "updatedReplicas": 0,
            "url": null,
        }));

        Ok(serde_json::json!({
            "name": app_name,
            "namespace": namespace,
            "status": status,
            "ingress": app.spec.ingress,
        }))
    }
}
