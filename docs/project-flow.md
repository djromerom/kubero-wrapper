## Estado implementado: registro y CI

El desarrollador vincula GitHub, selecciona repositorio y rama y registra el
proyecto. Atlas valida el acceso tanto a repositorios personales como a
organizaciones autorizadas para su GitHub App. Guarda el commit y una solicitud
CI de forma atómica e idempotente.

`ci_runs` registra la solicitud, ejecución Woodpecker, commit, imagen y digest.
Los estados son `blocked`, `queued`, `submitting`, `submission_unknown`,
`pending`, `running`, `verifying`, `published`, `failed` y `cancelled`.
`published` significa imagen verificada para linux/arm64; no implica despliegue.
El campo histórico `projects.status` queda separado de CI.

El backend no conecta con Kubernetes. Guardar configuración de despliegue sólo
la conserva. Archivar un proyecto CI conserva historial e imágenes; los recursos
históricos requieren una futura retirada coordinada, no se borran en esta fase.

[Contrato y requisitos externos de la configuración central](ci-integration.md).
Las cuotas, accesos temporales y Google funcional siguen pendientes.

## Diseño futuro (no implementado en esta fase)

Las siguientes etapas son documentación de destino, no capacidades verificadas.

## Integration
CI provisioning based on visibility, application packaging, automated testing, security checks, and publication of the approved OCI image to the registry. After successful publication, the project moves to **Deployment**.
### CI_PROVISIONING
After the repository transfer is confirmed, Atlas assigns a CI provider based on repository visibility: **Woodpecker** for private repositories and **GitHub Actions** for public repositories.

Atlas prepares or validates the CI configuration, triggers, permissions, and credentials. Once provisioning succeeds, it automatically creates the first execution and moves it to `PENDING_CI`. If provisioning fails, Atlas records the problem and allows a retry.
### PENDING_CI
The execution is queued until the assigned provider has the resources required to start. Each execution identifies the repository, branch, and exact commit SHA being evaluated.

When execution begins, it moves to `CI_RUNNING`. Subsequent pushes to the configured branch create new executions without repeating provisioning.
### CI_RUNNING
The CI provider coordinates the following steps
1. **Environment setup** prepare the execution environment and required tools.
2. **Code and dependencies** retrieve the exact commit and resolve the application’s dependencies.
3. **Candidate OCI image** use Kubero to package the application and build its candidate OCI image.
4. **Automated tests** run the required tests and verify the candidate application.
5. **Security layer** check the code, dependencies, exposed secrets, and candidate image against the platform’s security requirements.
6. **Registry** publication.

Both providers must apply the same mandatory checks. If any required step, including publication, fails, the execution moves to `FAILED_CI`. Once publication is confirmed, it moves to `PASSED_CI`.
### FAILED_CI
Atlas records the failed step, the reason, and relevant logs so the developer can address the problem. The execution does not authorize a deployment.

A corrective commit creates a new execution in `PENDING_CI`. A transient infrastructure failure may be retried using the same SHA. Previous execution results remain in the history.
### PASSED_CI
All mandatory checks have succeeded, and the registry contains the approved OCI image. Atlas records the commit SHA, CI execution, results, and immutable image digest.

The approved version automatically goes to **Deployment**, which will use that same image.
## Deployment
Deployment of the approved OCI image published during Integration. Each deployment attempt references the commit SHA, successful CI execution and immutable image digest.
### PENDING_DEPLOY
Atlas creates a deployment request for the approved image. It waits for the resources and conditions required to begin.

For the first deployment, Atlas prepares the application’s configuration and required services. For subsequent deployments, it identifies the existing application and the new version to deploy.

When the deployment begins, the attempt moves to `DEPLOYING`.
### DEPLOYING
Atlas coordinates the deployment through Kubero and Kubernetes.
1. **Apply configuration** create or update the application’s resources, environment variables, secrets, and required services.
2. **Retrieve the image** pull the approved image from the registry using its immutable digest, without rebuilding it.
3. **Start the application** create or update the application’s containers.
4. **Verify availability** check application health, routing, and HTTPS access, as applicable.

If the application becomes available and passes the required checks, the attempt moves to `DEPLOYED`. If a required step fails, it moves to `FAILED_DEPLOY`.
### FAILED_DEPLOY
Atlas records the failed step, the reason, and relevant logs. The failed attempt does not mark the candidate version as deployed.
The next action depends on the cause
- **Infrastructure or runtime configuration failure** after resolving issues such as insufficient resources, registry access, or incorrect environment variables, Atlas can retry the same approved image from `PENDING_DEPLOY`.
- **Application or image failure** goes to `PENDING_CI`, where the developer corrects the code or build configuration. The new commit must pass Integration before its image can enter `PENDING_DEPLOY`.

For an update, Atlas preserves or restores the previously working version when possible and verifies its health. The application may remain `DEPLOYED` on that version, while the unsuccessful attempt remains recorded as `FAILED_DEPLOY`. If no healthy version is available, Atlas reports the application as unavailable.
### DEPLOYED
The deployed version has passed the required availability checks and is serving traffic through its assigned URL.

Atlas records the deployed commit SHA, image digest, deployment date, and verification results. The dashboard displays the active version and provides access to its status and logs.

Subsequent updates follow Integration and create new deployment attempts without repeating **Registration**.
## Retirement
Administrative retirement, application suspension, temporary data retention, repository return, and removal from Atlas.

Administrative retirement starts in `RETAINED`. Voluntary retirement requires the developer’s explicit confirmation and moves the project directly to `SUSPENDED`, stopping the application and starting the data retention period.
### RETAINED
An administrator requests retirement, providing a reason and a response period of **7 or 14 days**. Atlas notifies the developer and records the deadlines. The application remains operational during the response period. No extensions are available.

The developer can accept retirement or request to cancel the retirement, explaining how the administrator’s concerns have been addressed.

Requesting retirement cancellation before the deadline pauses retirement while it is reviewed. If approved, retirement is canceled and the project returns to `DEPLOYED`. If rejected, the original response deadline still applies. If it has already passed, or the developer accepts the retirement, the project goes to `SUSPENDED`.
### SUSPENDED
Atlas stops the application, removes traffic, blocks new CI and deployment executions, and cancels pending work.

Persistent data is preserved with restricted access for the previously selected (by the administrator) **15 or 30 days**, starting from suspension. Atlas displays the deletion deadline and allows the developer to request and download data exports, excluding secrets and internal platform configuration.

Cancelling retirement is no longer available here. Once the retention period expires, the project moves to `PENDING_RETURN`.
### PENDING_RETURN
Atlas disables its integrations and removes platform-specific credentials, secrets, webhooks, and access. It then coordinates the repository’s transfer from OpenLab to the developer’s authorized GitHub account.

The project remains in this state until Atlas confirms the transfer. Failed or incomplete transfers require a retry or administrative intervention; the repository is never deleted.

After confirming the return, the project moves to DELETING.
### DELETING
Atlas removes the project’s remaining exclusive resources from Kubero and Kubernetes, including workloads, networking configuration, services, secrets, and persistent data. It also removes the project’s images from the registry and node caches, and reclaims image layers that are no longer referenced. Resources or image layers still required by other projects or the platform are preserved.

The project remains visible in Atlas while cleanup is in progress. Atlas verifies that the resources and images have been removed before going DELETED. Partial failures keep the project in DELETING, with the failed step and reason recorded, allowing cleanup to be retried without repeating completed steps or returning to PENDING_RETURN.
### DELETED
Atlas has confirmed the repository’s return and the removal of the project’s resources and data. The application is no longer hosted by Atlas, and its repository remains in the authorized developer GitHub account.

Atlas preserves the retirement audit record after closure, without retaining secrets or copies of application data. User accounts and shared platform resources are not deleted.

---
## Questions
- Can the repository visibility be changed after CI_PROVISIONING?
- Docker Hub Images Visibility
