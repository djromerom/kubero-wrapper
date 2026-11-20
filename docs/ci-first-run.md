# Primera prueba Wrapper → Woodpecker 3.18 → NAS

Esta guía es para ejecutarla **después** de que infraestructura entregue la
extensión y el publicador y se autorice la prueba real. No se ha ejecutado contra
infraestructura. No contiene pasos de Kubero, Kubernetes, Helm o modificación del
Registry. El resultado esperado es **Imagen publicada**, no una página desplegada.
Contrato obligatorio: [ci-integration.md, v2](ci-integration.md).

## 1. Entrega externa necesaria

- Woodpecker 3.18 accesible por HTTPS; repositorio piloto activado y cuenta técnica
  del PAT con permisos de consulta/ejecución. Confirmar su login exacto.
- Configuration Extension exclusiva, firma HTTP verificada y contrato v2;
  URL privada HTTPS del wrapper alcanzable desde ella y el publicador.
- Builder ARM64 aislado, checkout del SHA autorizado y publicador separado con
  procedencia del OCI, comprobación de IDs, escritura idempotente y permisos NAS
  limitados. Ningún secreto de Atlas/NAS en el repositorio o builder.
- Acceso de lectura al Registry para Atlas; URL, namespace y certificado/CA con
  SAN válido. El publicador entrega exactamente `atlas/<project_uuid>:<run_uuid>`.
- Archivos de secretos externos: PAT Woodpecker, token de configuración, token
  de publicación **distinto** y Bearer NAS de sólo lectura. Los dos tokens Atlas
  tienen al menos 32 caracteres aleatorios. CA pública en un archivo PEM.
- Usuario Atlas con GitHub vinculado y GitHub App instalada en el piloto. Usar
  inicialmente una web de una imagen ARM64, sin `.woodpecker.yaml` ni secretos.
  Compose de varias imágenes no forma parte de esta primera aceptación.

## 2. Preparación offline (PowerShell, raíz del repositorio)

Sustituir las rutas por las entregadas por el gestor de secretos; no crear los
secretos en el repositorio. Este overlay usa Bearer para NAS; para Basic usar las
variables `ATLAS_REGISTRY_USERNAME`/`ATLAS_REGISTRY_PASSWORD_FILE` del contrato.
Los valores de URL son referencias de la integración; confirmar DNS/SAN con el
equipo externo antes de la prueba.

```powershell
$env:ATLAS_CI_ENABLED = 'false'
$env:ATLAS_CI_CENTRAL_READY = 'false'
$env:ATLAS_CI_MODE = 'central'
$env:WOODPECKER_URL = 'https://wood.atlasfy.site'
$env:WOODPECKER_EXPECTED_AUTHOR = '<login-real-cuenta-tecnica>'
$env:ATLAS_REGISTRY_URL = 'https://10.10.10.10:5000'
$env:ATLAS_REGISTRY_NAMESPACE = 'atlas'
$env:ATLAS_WOODPECKER_TOKEN_PATH = 'D:\atlas-secrets\woodpecker-token'
$env:ATLAS_CI_CONFIGURATION_TOKEN_PATH = 'D:\atlas-secrets\ci-configuration-token'
$env:ATLAS_CI_PUBLICATION_TOKEN_PATH = 'D:\atlas-secrets\ci-publication-token'
$env:ATLAS_REGISTRY_READ_TOKEN_PATH = 'D:\atlas-secrets\registry-read-token'
$env:ATLAS_REGISTRY_CA_PATH = 'D:\atlas-secrets\registry-ca.pem'
$composeArgs = @('-f', 'compose.yaml', '-f', 'compose.ci-secrets.yaml')
docker compose @composeArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Configuración Compose inválida' }
docker compose @composeArgs build backend
if ($LASTEXITCODE -ne 0) { throw 'Compilación fallida' }
docker compose @composeArgs run --rm --no-deps backend kubero-wrapper --check-ci-config
if ($LASTEXITCODE -ne 0) { throw 'Configuración CI inválida' }
```

El último comando termina sin consultar DB, GitHub, Woodpecker o NAS y sin aplicar
migraciones. Valida configuración local y CA, no permisos ni conectividad remotos.
No usar `docker compose config` sin `--quiet` para compartir evidencia: puede
mostrar otras variables sensibles del wrapper. No utilizar scripts del antiguo
laboratorio. El Compose base conserva PostgreSQL/Redis propios del wrapper.

## 3. Arranque controlado, todavía sin CI

Usar la base del wrapper existente, con su copia de respaldo habitual. Aplicar la
imagen preparada al backend; las migraciones 013/014 son aditivas. PostgreSQL y
Redis deben estar operativos previamente; no sustituir sus volúmenes.

```powershell
docker compose @composeArgs up -d --no-deps backend
if ($LASTEXITCODE -ne 0) { throw 'Backend no actualizado' }
# Revisar intenciones existentes ANTES de activar el worker.
docker compose exec -T postgres psql -U postgres -d kubero_wrapper -c "SELECT id, project_id, repo_url, status, submitted_at FROM ci_runs WHERE completed_at IS NULL ORDER BY created_at;"
if ($LASTEXITCODE -ne 0) { throw 'No se pudo revisar la cola' }
```

El worker procesa todas las intenciones pendientes, no sólo el siguiente registro.
No activar hasta revisar que la cola sólo contenga intenciones autorizadas para
la prueba. Las enviadas sin contexto de migración 014 o en `submission_unknown`
necesitan conciliación, nunca un UPDATE para fingir éxito ni un POST duplicado.
Verificar que la implementación externa deniegue firma inválida, SHA/autor/IDs
incorrectos y tokens de propósito equivocado antes de permitir publicación.

## 4. Habilitación y registro — sólo con autorización para la prueba real

Estos comandos son deliberadamente el único paso de activación de la guía.

```powershell
$env:ATLAS_CI_CENTRAL_READY = 'true'
$env:ATLAS_CI_ENABLED = 'true'
docker compose @composeArgs up -d --no-deps backend
if ($LASTEXITCODE -ne 0) { throw 'No se pudo habilitar el backend' }

$base = 'http://localhost:3000/api' # HTTPS si el cliente no está en loopback
$email = Read-Host 'Correo del desarrollador Atlas con GitHub vinculado'
$password = Read-Host 'Contraseña Atlas' -AsSecureString
$plain = [System.Net.NetworkCredential]::new('', $password).Password
try {
  $login = Invoke-RestMethod "$base/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email=$email; password=$plain } | ConvertTo-Json)
} finally { $plain = $null; $password = $null }
$headers = @{ Authorization = "Bearer $($login.token)" }
$requestId = [guid]::NewGuid().ToString()
$repo = Read-Host 'URL GitHub canónica del repositorio piloto autorizado'
$body = @{ request_id=$requestId; name='Prueba CI Atlas'; repo_url=$repo; branch='main'; purpose='Primera verificación CI ARM64 en NAS' } | ConvertTo-Json
$project = Invoke-RestMethod "$base/projects" -Method Post -Headers $headers -ContentType 'application/json' -Body $body
$project.id
```

Si el registro pierde la respuesta, repetir **el mismo `$body`**, conservando
`request_id`. No generar otro UUID. El endpoint devuelve el mismo proyecto.
Si GitHub devuelve rechazo, corregir acceso/instalación; no omitir esa validación.

## 5. Seguimiento y aceptación

```powershell
$deadline = (Get-Date).AddMinutes(65)
do {
  $project = Invoke-RestMethod "$base/projects/$($project.id)" -Headers $headers
  $project.ci | Select-Object id, status, commit_sha, woodpecker_repo_id, pipeline_id, pipeline_number, platform, image_digest, image_reference, message
  if ($project.ci.status -in @('published', 'failed', 'cancelled', 'submission_unknown', 'blocked')) { break }
  Start-Sleep -Seconds 5
} while ((Get-Date) -lt $deadline)
if ($project.ci.status -ne 'published') { throw 'Prueba no aceptada: revisar ejecución, no reenviar POST' }
if ($project.ci.platform -ne 'linux/arm64' -or $project.ci.image_reference -notmatch '@sha256:[0-9a-f]{64}$') { throw 'Evidencia de imagen incompleta' }
$runs = Invoke-RestMethod "$base/projects/$($project.id)/ci/runs" -Headers $headers
$runs | Select-Object id, status, commit_sha, pipeline_id, pipeline_number, image_digest
```

Comparar la evidencia con Woodpecker y la copia OCI del publicador: mismo SHA,
autor, repo e IDs; manifiesto/config Linux ARM64 y digest NAS coincidente. Debe
verse **Imagen publicada** en Atlas, sin dominio ni recursos CD nuevos. Revisar
que logs/artefactos no contengan credenciales. Guardar sólo evidencia no sensible.
La aceptación incluye rechazos de acceso y de cambio de commit; un éxito aislado
no demuestra el aislamiento del publicador.

Para fallos terminales, tras corregir la causa y confirmar que la ejecución terminó:
`Invoke-RestMethod "$base/projects/$($project.id)/ci/retry" -Method Post -Headers $headers`.
Genera nueva autorización GitHub y nuevo run/tag. Si el estado es incierto, no usar
retry: consultar Woodpecker y conciliar primero. Un digest/arquitectura inválidos
nunca se convierten manualmente en `published`.

Al terminar, esperar la conciliación de todas las ejecuciones y desactivar:

```powershell
$env:ATLAS_CI_ENABLED = 'false'
$env:ATLAS_CI_CENTRAL_READY = 'false'
docker compose @composeArgs up -d --no-deps backend
$headers = $null; $login = $null
```

Desactivar CI revoca la API privada y detiene seguimiento; **no cancela pipelines
remotos**. Si se necesita una parada inmediata, coordinar su cancelación con
infraestructura. No borrar proyectos, imágenes, volúmenes o recursos para limpiar
la prueba.
