use k8s_openapi::api::core::v1::{Node, Pod};
use kube::{
    api::{Api, ListParams},
    config::{KubeConfigOptions, Kubeconfig},
    Client, Config as KubeConfig,
};

use crate::{
    error::AppResult,
    models::ClusterStatus,
};

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
        _namespace: &str,
        _project_slug: &str,
        _repo_url: &str,
        _branch: &str,
        _domain: &str,
    ) -> AppResult<()> {
        // TODO: Create Kubero Pipeline CRD
        Ok(())
    }

    pub async fn delete_pipeline_crd(&self, _namespace: &str, _pipeline_name: &str) -> AppResult<()> {
        // TODO: Delete Kubero Pipeline CRD
        Ok(())
    }

    pub async fn trigger_build(&self, _namespace: &str, _pipeline_name: &str) -> AppResult<()> {
        // TODO: Trigger Kubero Pipeline build
        Ok(())
    }
}
