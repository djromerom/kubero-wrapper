### GitHub Actions
CI provider for **public repositories**. During `CI_PROVISIONING`, Atlas prepares or validates its workflows, permissions, credentials, and triggers.

During `CI_RUNNING`, GitHub Actions coordinates environment setup, code retrieval, dependencies, image construction through Kubero, automated tests, security checks, and publication of the approved image to the registry. It reports execution status, results, and logs to Atlas.

### Woodpecker CI
CI provider for **private repositories**. During `CI_PROVISIONING`, Atlas activates or validates the repository’s integration, workflows, webhook, permissions, and credentials.

During `CI_RUNNING`, Woodpecker coordinates the same mandatory steps as GitHub Actions, using execution environments provided through its Kubernetes backend. It reports execution status, results, and logs to Atlas.
### Kubernetes with K3s
Infrastructure that runs the platform’s workloads. **K3s is the Kubernetes distribution used by Atlas.**

Kubernetes provides execution resources for Woodpecker jobs, Kubero builds, and hosted applications. During Deployment, it pulls the approved image, schedules workloads, manages networking and storage, and maintains the desired application state.

During Retirement, it enforces application shutdown and manages the preservation or removal of project resources as instructed by Atlas through its infrastructure integrations.
### Kubero
Application build and deployment layer operating on Kubernetes.

During `CI_RUNNING`, Kubero builds the candidate OCI image from the selected commit, using the supported build method and project configuration. The assigned CI provider coordinates this operation and the checks required before the image is approved.

During Deployment, Atlas uses Kubero to create or update the application with the approved image and runtime configuration. Kubernetes executes the resulting workloads. Kubero does not replace CI validation or administrative admission.
### Docker Hub