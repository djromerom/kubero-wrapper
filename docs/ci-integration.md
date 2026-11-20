# Atlas → Woodpecker 3.18 → Registry: contrato v2

## Alcance y estado

El wrapper implementa autorización GitHub, cola transaccional, solicitud y
seguimiento de CI, recuperación de respuestas inciertas y verificación de imagen.
No instala ni modifica Helm, Kubernetes, Woodpecker o el Registry. No despliega
aplicaciones, Ingress o recursos Kubero. No implementa Pigsty.

La Configuration Extension y el publicador protegido se implementan por separado.
La conexión real y el criterio de aceptación **no están verificados**. Los mocks
demuestran el contrato del wrapper, no el funcionamiento del clúster.

## Contrato Woodpecker comprobado en v3.18.0

Se consultó código público etiquetado; no se consultó `wood.atlasfy.site`:

- [API de pipelines v3.18.0](https://github.com/woodpecker-ci/woodpecker/blob/v3.18.0/server/api/pipeline.go):
  `POST /api/repos/{repo_id}/pipelines`, `GET /api/repos/{repo_id}/pipelines` y
  `GET /api/repos/{repo_id}/pipelines/{pipeline_number}`. El POST recibe `branch`,
  `message` y `variables`; resuelve `BranchHead`, **no admite fijar un SHA**.
- [Lookup de repositorios](https://github.com/woodpecker-ci/woodpecker/blob/v3.18.0/server/api/repo.go):
  `GET /api/repos/lookup/{owner}/{repo}`. Se comprueban ID, `active`, `full_name`
  y `forge_url`; el repositorio debe estar activado previamente en Woodpecker.
  Atlas no activa repositorios ni crea webhooks en esta fase.
- [Modelo del pipeline](https://github.com/woodpecker-ci/woodpecker/blob/v3.18.0/server/model/pipeline.go):
  se diferencian el ID global y el número dentro del repositorio. En 3.18,
  `repo_id` no se serializa en el JSON del pipeline: el cliente lo vincula al
  repositorio de la URL solicitada, no exige un campo de versiones posteriores.
- [Configuration Extension](https://woodpecker-ci.org/docs/3.18/usage/extensions/configuration-extension)
  y [configuración del servidor](https://woodpecker-ci.org/docs/3.18/administration/configuration/server):
  permiten generar configuración central. Infraestructura debe habilitar el modo
  exclusivo para que no se lea ni se acepte YAML arbitrario del estudiante.

El cliente usa `Authorization: Bearer <PAT>`, timeout, límites de respuesta y
redirecciones deshabilitadas. No expone cuerpos de error externos ni logs de
pipeline en la API. Un éxito de Woodpecker por sí solo nunca marca la imagen como
publicada.

## Variables del wrapper

| Variable | Uso / valor inicial |
|---|---|
| `ATLAS_CI_ENABLED` | `false`. Habilita el worker; no activarlo sin autorizar la conexión real. |
| `ATLAS_CI_MODE` | `central` (destino) o `repository-test` (piloto restringido). |
| `ATLAS_CI_CENTRAL_READY` | `false`. Confirmación operativa de que la política central está instalada; no es autodetección. |
| `WOODPECKER_URL` | Origen HTTPS, p. ej. `https://wood.atlasfy.site`, sin `/api`. |
| `WOODPECKER_TOKEN` | PAT de cuenta técnica con permiso de ejecutar/ver los repositorios habilitados. Sólo backend. |
| `WOODPECKER_EXPECTED_AUTHOR` | Login de la cuenta técnica del PAT, obligatorio; la extensión y Atlas rechazan ejecuciones de otro autor. |
| `ATLAS_CI_AUTHORIZATION_TOKEN` | Secreto aleatorio de al menos 32 caracteres compartido únicamente con la Configuration Extension. Nunca al pipeline. |
| `ATLAS_CI_PUBLICATION_TOKEN` | Secreto distinto, de al menos 32 caracteres, exclusivo del publicador aislado. Nunca al builder ni al YAML. |
| `*_FILE` | Alternativa para `WOODPECKER_TOKEN`, `ATLAS_CI_AUTHORIZATION_TOKEN`, `ATLAS_CI_PUBLICATION_TOKEN`, `ATLAS_REGISTRY_PASSWORD` y `ATLAS_REGISTRY_TOKEN`. Archivo externo UTF-8, máximo 64 KiB; se quita el salto final. Valor directo y archivo son excluyentes; error al cargar aborta el arranque sin imprimir el secreto. |
| `ATLAS_REGISTRY_URL` | `https://10.10.10.10:5000`, sin `/v2`. El certificado debe incluir la IP en SAN; usar otro nombre sólo si coincide con el certificado y el publicador. |
| `ATLAS_REGISTRY_NAMESPACE` | `atlas`; prefijo de repositorios de imágenes asignado por infraestructura. |
| `ATLAS_REGISTRY_USERNAME`, `ATLAS_REGISTRY_PASSWORD` | Credencial **sólo lectura** con Basic para verificación. |
| `ATLAS_REGISTRY_TOKEN` | Alternativa: Bearer preemitido de sólo lectura. No mezclar con Basic. |
| `ATLAS_REGISTRY_CA_FILE` | Ruta PEM dentro del contenedor backend; añade confianza sin deshabilitar TLS ni hostname. |
| `ATLAS_CI_HTTP_TIMEOUT_SECONDS` | 15 (1–60). |
| `ATLAS_CI_POLL_SECONDS` | 5 (1–300). |
| `ATLAS_CI_RUN_TIMEOUT_SECONDS` | 3600 (60–86400); también limita la autorización de publicar. |
| `ATLAS_CI_TEST_REPOSITORY` | URL canónica del único repositorio piloto permitido en `repository-test`. |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` | Integración individual GitHub existente, independiente del PAT Woodpecker. |
| `GITHUB_API_URL` | Por defecto `https://api.github.com`; sólo se cambia en pruebas aisladas. |
| `ATLAS_CI_ALLOW_HTTP_LOOPBACK` | Sólo tests: permite HTTP exclusivamente en loopback. Nunca habilita HTTP hacia la NAS ni desactiva validación TLS. |

El Registry puede usar confianza pública del sistema; si requiere CA, infraestructura
montará el certificado público de `atlas-registry-ca` también en el backend, no sólo
en BuildKit. El Compose del wrapper no monta automáticamente el ConfigMap del
clúster. Hay que suministrar el archivo de sólo lectura y su ruta de contenedor.
No se persisten estos secretos en PostgreSQL ni se incluyen en respuestas al usuario.
Si el Registry exige negociación de tokens, suministrar un Bearer válido mediante
el gestor de secretos y rotarlo; esta versión no sigue realms de autenticación
arbitrarios ni renueva tokens de Registry automáticamente.

## Identidad de una construcción

El navegador envía `request_id` UUID, estable durante los reintentos de registro.
Una restricción por usuario y bloqueo transaccional devuelven el mismo proyecto
para la misma petición; reutilizar el UUID con otro contenido devuelve 409.
Los clientes externos deben conservar ese UUID: omitirlo crea una nueva intención.

Proyecto y `ci_runs` se escriben en una sola transacción. Sólo existe una ejecución
activa por proyecto. El worker revalida GitHub antes de solicitar CI. No se
reconstruyen proyectos históricos al aplicar la migración.

Atlas envía únicamente:

```json
{
  "branch": "main",
  "message": "atlas:<run_uuid>",
  "variables": {
    "ATLAS_RUN_ID": "<run_uuid>",
    "ATLAS_COMMIT_SHA": "<sha_40>",
    "ATLAS_IMAGE": "10.10.10.10:5000/atlas/<project_uuid>:<run_uuid>",
    "ATLAS_PLATFORM": "linux/arm64"
  }
}
```

Woodpecker guarda el mensaje como `MANUAL: atlas:<run_uuid> @ main`.
La imagen autorizada es `<registry>/<namespace>/<project_uuid>:<run_uuid>`.
El destino no lo elige el repositorio. El tag es único por intento; la referencia
final es inmutable, `<registry>/<namespace>/<project_uuid>@sha256:...`.
`ATLAS_IMAGE` facilita adaptar el piloto existente. En modo central la extensión
y el publicador deben obtener el destino de la API privada y compararlo; no deben
autorizar una publicación basándose sólo en variables de pipeline.

El API manual puede observar una rama que cambió entre la validación y el POST.
**La extensión debe comparar `pipeline.commit` con el SHA autorizado antes de
devolver configuración.** Ante diferencias debe rechazar el trabajo. Atlas también
compara repo, rama, commit, evento, mensaje e IDs al seguir la ejecución y bloquea
la publicación observada si no coinciden. No se pasa un falso parámetro `commit`
al API de Woodpecker.

## API privada de autorización para la extensión / publicador

`GET /api/internal/ci/runs/{run_uuid}/authorization`

Propósito de configuración (predeterminado por compatibilidad):
`?purpose=configuration`, `Authorization: Bearer <ATLAS_CI_AUTHORIZATION_TOKEN>`.
Propósito de publicación: `?purpose=publication`,
`Authorization: Bearer <ATLAS_CI_PUBLICATION_TOKEN>`.
Los dos secretos deben ser distintos; ninguno concede el permiso del otro.
Las respuestas de autorización llevan `Cache-Control: no-store`. No cachearlas,
no incluir tokens en URLs, logs, repositorios, variables o artefactos del pipeline.
Esta API no es una Configuration Extension: no recibe la firma nativa de
Woodpecker y no devuelve YAML. Es la interfaz entre el wrapper y los componentes
centrales, sobre HTTPS y limitada por red a esos servicios.

Ejemplo de respuesta:

```json
{
  "contract_version": 2,
  "purpose": "configuration",
  "run_id": "<run_uuid>",
  "project_id": "<project_uuid>",
  "repo_url": "https://github.com/organizacion/proyecto",
  "branch": "main",
  "commit_sha": "<sha_40>",
  "woodpecker_repo_id": 11,
  "pipeline_id": null,
  "pipeline_number": null,
  "event": "manual",
  "expected_author": "<login-cuenta-tecnica>",
  "woodpecker_url": "https://wood.atlasfy.site",
  "expected_message": "MANUAL: atlas:<run_uuid> @ main",
  "registry": "https://10.10.10.10:5000",
  "image_repository": "atlas/<project_uuid>",
  "image_tag": "<run_uuid>",
  "platform": "linux/arm64",
  "expires_at": "<RFC3339>"
}
```

Los IDs pueden ser nulos sólo en la autorización de configuración durante el
POST: Woodpecker solicita la configuración antes de devolver el pipeline a Atlas.
La extensión comprueba que el autor firmado sea `expected_author`, y compara
repositorio, rama, SHA, evento, mensaje y los IDs cuando existan. Un UUID copiado
no autoriza nada. No interpretar `pipeline.signed` como validación criptográfica
de la petición HTTP: la firma de transporte se verifica por separado.

La autorización de publicación exige estado `pending`, `running` o `verifying`,
`woodpecker_repo_id`, `pipeline_id` y `pipeline_number` positivos ya conciliados.
El publicador compara los tres IDs con su identidad confiable de ejecución y
consulta el pipeline en el origen Woodpecker devuelto. No acepta IDs declarados
por el código del estudiante ni espera el éxito final del pipeline.

| Respuesta | Significado / acción del consumidor |
|---|---|
| 200 JSON v2 | Comparar toda la identidad y el propósito; usar hasta `expires_at`, consultando de nuevo justo antes de publicar. |
| 401 | Token ausente/incorrecto, propósito desconocido, permiso equivocado, CI deshabilitado, central no preparada o modalidad distinta. No reintentar con otro permiso. |
| 404 | UUID inválido/inexistente o proyecto archivado/en proceso de archivo; sólo se revela después de autenticar. |
| 409 | Estado no autorizado, expiración, contexto cambiado/incompleto o IDs pendientes. No construir/publicar; si el POST sigue en curso, el publicador puede volver a consultar de forma acotada. |
| 5xx / timeout | Denegar por defecto. Reintentar lectura con backoff, sin superar la expiración. |

`configuration` admite `submitting`, `pending`, `running`, `verifying`;
`publication` excluye `submitting`. Ambos rechazan `queued`, `blocked`,
`submission_unknown` y estados terminales, incluso si conservan IDs.
Se exige `submitted_at <= ahora < expires_at` y `completed_at IS NULL`.
Una ejecución futura, expirada o completada nunca obtiene permiso.

La migración 014 guarda origen Woodpecker, origen Registry, autor y vencimiento
antes del POST. También se exige que el repositorio de imagen corresponda al
namespace configurado/proyecto, el tag al UUID y la plataforma a `linux/arm64`.
Cambiar destino, namespace o autor pausa el seguimiento de ejecuciones enviadas
hasta conciliación; no las redirige. Cambiar el timeout no amplía permisos ya
emitidos. Las ejecuciones enviadas antes de esta migración carecen de contexto
confiable y quedan pendientes de conciliación; no se les inventa un destino.
Rotar los tokens sin cambiar las identidades/destinos no altera el contexto.

## Responsabilidades externas y publicación aislada

Infraestructura, mediante su propia configuración Helm/Kubernetes:

1. Activar los repositorios autorizados en Woodpecker y dar acceso a la cuenta
   técnica. La autorización individual del usuario sigue resolviéndose en Atlas.
2. Instalar la Configuration Extension y configurar
   `WOODPECKER_CONFIG_EXTENSION_ENDPOINT` y
   `WOODPECKER_CONFIG_EXTENSION_EXCLUSIVE=true`. Verificar firmas HTTP de
   Woodpecker contra su clave pública y rechazar solicitudes no auténticas.
   Ajustar la política de hosts permitidos cuando la extensión sea interna.
3. La extensión consulta la autorización de Atlas, comprueba identidad y caducidad
   y genera exclusivamente la plantilla administrada. No mezcla YAML estudiantil,
   variables de usuario que cambien el destino, pasos arbitrarios o secretos de
   publicación. Controlar quién puede alterar las extensiones/configuración del
   repositorio en Woodpecker; la exclusividad por sí sola no sustituye esa política.
4. Ejecutar el código no confiable con BuildKit rootless ARM64 sin socket Docker,
   credenciales generales de NAS ni credenciales del publicador montadas en su
   entorno. Aislar cachés, volúmenes y red entre proyectos.
5. Exportar un artefacto OCI a almacenamiento temporal aislado. Un **publicador
   administrado separado**, con identidad propia y sin ejecutar código del
   proyecto, comprueba ejecución/commit/autorización, copia únicamente ese OCI al
   destino autorizado y verifica su digest. Alternativamente emitir capacidades
   breves y limitadas a un único repositorio/tag, con enforcement real del servicio
   de publicación. Un secreto global inyectado en un paso de pipeline arbitrario
   no satisface este contrato.
6. El paso controlado de publicación debe completarse antes de que el pipeline
   resulte `success`. El publicador verifica la identidad y los pasos previos;
   no debe esperar el éxito final del propio pipeline, lo que causaría un ciclo.
7. Montar la CA en BuildKit, publicador y wrapper. Suministrar al wrapper sólo
   lectura del Registry. Limitar red e identidades de servicio.

Atlas no entrega el secreto interno a Woodpecker como variable de pipeline.
`ATLAS_RUN_ID` identifica una solicitud; no es por sí mismo una autorización.
La API del Registry acredita contenido/digest/plataforma, **no prueba por sí sola
que el código construido sea el commit solicitado**: esa vinculación corresponde
a la extensión y al publicador aislado. No declarar el criterio de aceptación
cumplido hasta verificar este aislamiento real.

## Consulta, recuperación y CD futuro

Atlas consulta el pipeline, exige éxito y usa `GET /v2/{repo}/manifests/{tag}` y
`GET /v2/{repo}/blobs/{config_digest}` según la
[OCI Distribution Specification](https://github.com/opencontainers/distribution-spec/blob/v1.1.1/spec.md).
Compara `Docker-Content-Digest` con SHA-256 de los bytes recibidos; si hay índice,
verifica el manifiesto hijo ARM64 y su config. Comprueba `os=linux` y
`architecture=arm64`. No sigue redirects. No publica ni borra imágenes.

Los locks con lease impiden que dos workers envíen la misma solicitud. Se guarda
`submitting` antes del POST. Un timeout, 5xx, respuesta ilegible o reinicio lleva a
conciliación por mensaje/evento/rama, nunca a repetir ciegamente el POST (Woodpecker
3.18 no ofrece una clave de idempotencia para este endpoint). Una búsqueda limitada
o sin resultado no demuestra que no hubo ejecución. `submission_unknown` permanece
activa y bloquea reintentos: un operador debe investigar y conciliar en la base
de Atlas con los IDs comprobados; no hay botón que fuerce otra construcción.
No modificar ese estado sin verificar que no haya una ejecución remota viva.

Un pipeline aún activo que exceda el plazo sigue en seguimiento, bloqueando otro
intento. Si terminó pero la imagen no se verificó dentro del plazo, CI falla. Los
reintentos explícitos de intentos terminales vuelven a autorizar GitHub y generan
un nuevo UUID/tag. Las operaciones de archivo no eliminan imágenes ni recursos.

La futura integración CD debe consumir exclusivamente `ci_runs.status=published`,
`image_reference` por digest y `platform`, mediante su propia cola y autorización.
No utilizar el campo histórico `approved` para iniciar despliegues.

## Conectividad y formatos de los componentes externos

| Emisor → receptor | Endpoint y autenticación | Formato / condición |
|---|---|---|
| Wrapper → GitHub | `GET /user/installations`, `/user/installations/{id}/repositories`, `/repos/{owner}/{repo}/branches`, `/repos/{owner}/{repo}/commits`; token individual de GitHub App | HTTPS, JSON paginado, acceso revalidado antes del POST. |
| Wrapper → Woodpecker 3.18 | Lookup, POST manual, GET lista y detalle indicados arriba; Bearer PAT técnico | JSON, sin secretos en `variables`; lista paginada para conciliar. |
| Woodpecker server → Configuration Extension | `POST <WOODPECKER_CONFIG_EXTENSION_ENDPOINT>` (URL elegida por infraestructura) | Petición HTTP firmada nativamente; JSON `{repo, pipeline, configuration?, netrc?}` de 3.18. |
| Extension → Wrapper | `GET /api/internal/ci/runs/{uuid}/authorization?purpose=configuration`; Bearer de configuración | JSON v2. La extensión extrae UUID del mensaje firmado, compara identidad y responde exclusivamente plantilla administrada. |
| Publicador → Wrapper | Mismo GET, `purpose=publication`; Bearer de publicación | JSON v2, IDs positivos y destino exacto; volver a consultar inmediatamente antes de escribir. |
| Publicador → Woodpecker | `GET /api/repos/{repo_id}/pipelines/{pipeline_number}`; credencial propia de lectura | Comparar ID global, commit, rama, autor, evento y mensaje; comprobar pasos previos y procedencia del artefacto. |
| Wrapper → NAS | `GET /v2/{repository}/manifests/{tag o digest}` y `/blobs/{digest}`; Basic o Bearer de lectura | OCI/Docker manifest/index y config, `Docker-Content-Digest: sha256:…`, TLS válido. No PUT, PATCH o DELETE. |
| Publicador → almacenamiento temporal / NAS | Transporte de artefacto aislado y OCI Distribution autenticado para push, por infraestructura | Permisos limitados al destino, sin ejecutar el artefacto; OCI vinculado de forma confiable al run/pipeline/SHA. |

El receptor de la extensión debe implementar el protocolo de firmas de
[extensiones Woodpecker 3.18](https://woodpecker-ci.org/docs/3.18/usage/extensions),
HTTP Signatures (draft-cavage), con claves **Ed25519**. Infraestructura obtiene y
fija la clave desde `GET <WOODPECKER_URL>/api/signature/public-key` por un canal
confiable y verifica con una biblioteca compatible (p. ej. `httpsign`), incluyendo
cuerpo/digest y frescura. No obtener una clave desde una URL enviada por el
solicitante ni reemplazar la firma por el Bearer interno de Atlas. Rechazar replays
que pretendan autorizar otra identidad. Para direcciones internas, infraestructura
debe ajustar `WOODPECKER_EXTENSIONS_ALLOWED_HOSTS` al host/CIDR de la extensión;
no requiere abrir todos los hosts. Estas variables pertenecen al servidor externo,
no al wrapper. Respuesta de éxito:

```json
{"configs":[{"name":"atlas-central","data":"<YAML Woodpecker administrado>"}]}
```

Rechazos de firma/política deben producir error, nunca `204` (que permite mantener
configuración recibida) ni YAML de un repositorio como fallback. En exclusiva no
se necesitan `configuration` ni `netrc` para autorizar. Si se habilita `netrc` por
necesidades de clonación, tratarlo como secreto y no registrarlo ni entregarlo al
publicador. El clone/build debe fijar el SHA autorizado y verificar el checkout.

**Interfaz del publicador:** Atlas no llama a un endpoint de publicación ni recibe
callbacks. El publicador es un componente externo del pipeline administrado.
Por tanto, el wrapper no impone una URL o API de entrada inexistente. El equipo
externo debe acordar/documentar su transporte autenticado (servicio o job),
identidad del solicitante y referencia al OCI temporal. Como mínimo debe vincular
`run_id`, `woodpecker_repo_id`, `pipeline_id`, `pipeline_number`, `commit_sha` y el
digest del artefacto mediante evidencia confiable; los datos del estudiante no
son evidencia. Debe serializar publicaciones por run, no sobrescribir un tag con
otro contenido y devolver al paso administrado éxito sólo tras confirmar la
copia/digest en NAS. Reintentos del mismo OCI son idempotentes; otro digest o
identidad se rechazan. La API privada es un permiso temporal de lectura,
**no una capacidad de un solo uso ni una reserva de publicación**.

El publicador debe esperar la conciliación de IDs si recibe 409 durante el POST;
si se agota el plazo, falla cerrado. Un pipeline no se marca `success` hasta que
termine esta operación. Atlas después verifica ARM64 y digest independientemente.

DNS, rutas, TLS y ACL deben permitir esos enlaces entre servicios. La URL privada
del wrapper debe ser alcanzable desde extensión y publicador; `localhost` de sus
contenedores no apunta al wrapper. Proteger esta ruta en proxy/red y conservar
`Authorization` y query string. El builder no recibe ninguno de los dos tokens de
Atlas ni acceso de escritura a NAS. Wrapper no requiere socket Docker, kubeconfig,
API Kubernetes, Helm, Kubero ni conectividad a registros del laboratorio antiguo.
El acceso de clonación y el canal de artefactos se resuelven fuera del wrapper.

## Conectar cuando termine infraestructura

Guía operativa con comandos: [Primera prueba real](ci-first-run.md).
Validación offline: `kubero-wrapper --check-ci-config` comprueba orígenes,
credenciales, separación de permisos y carga de CA sin DB, migraciones ni HTTP;
requiere `ATLAS_CI_ENABLED=false`. No demuestra permisos remotos ni compatibilidad
de las implementaciones externas. `compose.ci-secrets.yaml` monta únicamente
archivos externos de lectura y conserva los flags desactivados por defecto.

1. Acordar con el equipo externo este contrato v2, plantilla de construcción
   (incluido alcance de Dockerfile/Compose), autenticación y destino de imagen.
   Compose mult-servicio aún requiere acordar varias imágenes; esta fase registra
   **una imagen por ejecución** y no reutiliza el desplegador Compose local.
2. Confirmar extensión exclusiva, firmas, publicador aislado, permisos del PAT,
   acceso de lectura al Registry y CA/SAN correctos. Configurar las variables con
   CI deshabilitado mientras se completa la preparación.
3. Piloto opcional: `ATLAS_CI_MODE=repository-test` y
   `ATLAS_CI_TEST_REPOSITORY=https://github.com/<owner>/atlas-ci-test` reutilizan su
   pipeline funcional únicamente si acepta las variables del contrato, verifica
   `ATLAS_COMMIT_SHA` y publica `ATLAS_IMAGE` para `ATLAS_PLATFORM`. Su pipeline actual
   no ha sido inspeccionado: no se puede asegurar compatibilidad. No trasladar
   sus secretos a otros repositorios. Este piloto no cumple la centralización.
4. Para aceptación final usar `central`, confirmar operativamente
   `ATLAS_CI_CENTRAL_READY=true` y, **tras autorizar la prueba real**, habilitar CI.
   Registrar desde Atlas un repositorio de prueba sin `.woodpecker.yaml`,
   certificados ni secretos, seleccionar rama y observar `Imagen publicada`.
5. Comprobar commit e IDs coincidentes, digest ARM64 en NAS, ausencia de secretos
   en repo/logs y ausencia de recursos CD creados. Comprobar también un repositorio
   no autorizado y una rama que cambie durante el registro. Conservar evidencia.

Bloqueos actuales: no se ha confirmado la Configuration Extension operativa, su
contrato con el publicador, el acceso técnico, la CA montada en el wrapper ni la
compatibilidad del pipeline piloto. No se han ejecutado pruebas reales.
