# Auditoría de transición a CI (2026-11-18)

## Dependencias observadas

El registro validaba GitHub y escribía `projects.status=approved`. El monitor
Node reclamaba ese estado, descargaba código, construía con Kubero o Compose,
publicaba en un registro local y creaba recursos Kubernetes. Los reintentos y la
configuración regresaban a esa misma cola. `builds.status` reutiliza el enum de
despliegue, por lo que no es adecuado para representar una imagen publicada.

`start-local-kubero` y `watch-local-environment` arrancan el laboratorio y el
monitor; `setup-k3s` depende de `infra/k3d.yaml` y del parche del operador.
`deploy-local` depende de `kubero-build`, `deploy-compose`, `project-services`,
`cluster-settings`, `cluster-operation` y `runtime`. `delete-local` e
`image-cleanup` eliminan recursos e imágenes. Las pruebas Node importan varias
de esas funciones con dobles: conservamos esas pruebas y módulos reutilizables.

## Decisión

- Conservar autenticación, GitHub App por usuario, proyectos, permisos,
  configuración guardada, historial de builds y todas las migraciones 001–012.
- Añadir una cola persistente `ci_runs`, independiente del estado de CD. No
  convertir proyectos antiguos en nuevas construcciones automáticamente.
- Desactivar los comandos del laboratorio en su punto de entrada compartido.
  Conservar el código que importan pruebas independientes y los cambios locales
  previos del usuario. Retirar las plantillas exclusivas de creación del
  laboratorio; no ejecutar `down`, limpieza de volúmenes ni borrados del clúster.
- No inicializar el cliente Kubernetes en el backend. CD y sus endpoints quedan
  desactivados; conservar los registros históricos y el módulo para una futura
  revisión de la integración real.
- GitHub sigue siendo la autoridad de acceso al código. Retirar la restricción
  artificial de propietario personal; aceptar también organizaciones cuando la
  GitHub App y el usuario tienen acceso. Paginar instalaciones y repositorios.
- Los estados de CI no significan que la aplicación esté desplegada.

## Límite de esta entrega

Sólo código del wrapper y pruebas con servicios simulados. La configuración
central de Woodpecker, sus firmas, BuildKit, aislamiento, CA y publicador protegido
pertenecen al trabajo externo. No se han verificado contra el clúster real.

## Archivos de entrega

- Backend: nuevos `src/ci.rs`, `src/ci_clients.rs` y migración
  `013_ci_runs.sql`; adaptación de `src/routes.rs`, `src/github.rs`,
  `src/main.rs`, `src/config.rs`, `src/models.rs`, `Cargo.toml` y `Cargo.lock`.
- Frontend: nuevo `content/CiPanel.tsx`; cambios en `api.ts`, registro, paneles de
  proyectos, estados/filtros, detalle, configuración, archivo y documentación.
- Configuración: `.env.example` y `compose.yaml`; CI deshabilitado inicialmente.
- Retirados: `compose.kubero.yaml`, `compose.cluster.yaml`, `infra/k3d.yaml`,
  `infra/kubero-operator/Dockerfile` y `patch-build-chart.py`.
- Comandos heredados desactivados en `scripts/runtime.mjs`; se mantienen módulos
  de análisis Compose, adaptación y utilidades probadas con dobles, sin formar
  parte del nuevo flujo de ejecución.
- Pruebas: nueva `backend/tests/ci_integration.rs`, pruebas cliente/TLS dentro
  de `ci_clients.rs`, adaptación de `http_integration.rs` y `api.test.cjs`, nueva
  `scripts/tests/retired-lab.test.mjs`.
- Documentación: `README.md`, `project-flow.md`, esta auditoría y
  `ci-integration.md` (contrato y conexión).

Se preservaron los cambios locales previos en `scripts/start-local-kubero.mjs`,
`.github/`, `scripts/cluster-readiness.mjs`, su prueba y `docs/project-flow.pdf`.
No se hicieron commits ni se eliminaron volúmenes, datos o recursos existentes.

## Validación ejecutada

Esta sección recoge la primera entrega. La continuación y sus comprobaciones
actualizadas se detallan al final.

- Backend compilado con `cargo test --release --locked --offline --no-run`.
- 9 pruebas unitarias Rust, incluidas CA TLS, hostname y rechazo de redirecciones.
- 2 suites HTTP/integración aprobadas en PostgreSQL/Redis desechables sobre red
  Docker interna: permisos, operaciones de proyectos, registro idempotente,
  repositorio de organización paginado, publicación ARM64, respuesta perdida,
  timeout, reintentos, commit incorrecto, digest inválido y Registry pendiente.
- 6 pruebas del cliente frontend, 30 pruebas Node existentes y 1 prueba adicional
  de desactivación de los comandos del laboratorio aprobadas.
- Build de frontend y lint aprobados; permanecen dos advertencias previas de
  Fast Refresh en AuthContext y ToastProvider.
- `git diff --check` aprobado. No pruebas contra GitHub, Woodpecker ni NAS reales.
  La consulta de documentación/código público de Woodpecker no utilizó cuentas
  del usuario ni sus servicios. La prueba final de centralización sigue pendiente.

## Continuación: autorización y conexión externa (2026-11-18)

Se revisaron `main.rs`, rutas de registro/reintento/archivo, worker, clientes HTTP,
migraciones, entradas de scripts y Compose. El flujo activo es
`routes → ci::enqueue → worker → GitHub/Woodpecker/Registry`. No importa ni ejecuta
los adaptadores Node, el módulo Kubero histórico, Docker, Helm o Kubernetes.
La suite HTTP arranca sin kubeconfig y verifica que CI no cree builds de CD;
las pruebas Node conservadas usan dobles. No se recreó el laboratorio ni se
modificaron Kubernetes, Helm o Registry. Las eliminaciones de plantillas ya
existían en el árbol de trabajo de la entrega previa.

Hallazgos cerrados:

| Hallazgo | Cambio y evidencia |
|---|---|
| Un token compartido autorizaba configuración y publicación, incluso antes de conocer el pipeline | Contrato v2 con `purpose`, tokens distintos y permisos separados. Publicación exige IDs positivos conciliados. HTTP prueba intercambio de tokens, JWT de usuario, token vacío/incorrecto y propósito desconocido. |
| Estado incierto y expiración truncada podían conceder autorización | Se rechaza `submission_unknown`, terminales y `completed_at`; ventana estricta con fechas futuras y expiración exacta rechazadas. Matriz HTTP con estados, timestamps ausentes/vencidos/futuros y ejecución completada. |
| Contexto de ejecuciones enviadas dependía de configuración mutable | Migración aditiva 014 persiste orígenes, autor y vencimiento antes del POST. API deniega discrepancias; worker pausa su seguimiento para conciliación sin redirigir ni reenviar. Matriz HTTP prueba cambio de CI/Registry, autor, destino, tag y plataforma. |
| No había carga de secretos montados ni preflight offline | Cinco secretos admiten `_FILE`; conflictos, archivos vacíos, inválidos, ausentes o demasiado grandes fallan sin revelar contenido. Overlay del wrapper con archivos externos y validación CLI sin red/DB. |
| Contrato externo no distinguía claramente el permiso del publicador | Tabla de endpoints/auth/formatos/red, firmas Ed25519 de Woodpecker 3.18, política de rechazos y responsabilidad del canal OCI. Publicador no tiene endpoint de entrada implementado en Atlas. |

Pruebas ejecutadas en esta continuación:

- Compilación release bloqueada/offline en la imagen Rust disponible, con
  `docker build --network=none`; sin descargar dependencias ni usar CI real.
- `cargo test --release --locked --offline -- --include-ignored --test-threads=1`
  sobre PostgreSQL/Redis desechables en red Docker `--internal`: **13 aprobadas**
  (10 unitarias, 1 CLI offline y 2 HTTP/integración). Contenedores y red de prueba
  retirados; no se tocaron volúmenes del wrapper ni recursos existentes.
- Ciclo HTTP: registro concurrente idempotente → autorización GitHub paginada →
  autorización de configuración → POST Woodpecker → seguimiento → autorización
  de publicación vinculada a IDs → verificación ARM64/digest → `published`.
- Fallos: respuesta de POST perdida/timeout sin duplicarlo, pipeline fallido,
  reintento explícito y duplicado rechazado, Registry todavía sin imagen, digest
  incorrecto, AMD64, cambio de SHA antes del POST y SHA/autor incorrectos en CI.
  Rechazos de acceso a repositorios, historial ajeno y archivo/retry de run incierto.
- `npm test --prefix scripts`: **31 aprobadas**, incluida desactivación del lab.
  `npm test --prefix frontend`: **6 aprobadas**. No se modificó frontend en esta
  continuación; se conserva la validación build/lint de la entrega anterior.
- `docker compose --env-file .env.example -f compose.yaml -f compose.ci-secrets.yaml
  config --quiet`: aprobado, con rutas de archivos de ejemplo sin secretos para
  validar únicamente el esquema. No arrancó servicios ni validó credenciales reales.
- `git diff --check`: aprobado. Persisten advertencias previas Rust de código
  histórico sin uso; sin fallos de compilación o pruebas.

Límites pendientes: no se ejecutó una Configuration Extension real ni se verificó
su firma en el wrapper (eso corresponde al componente externo). Los mocks no
construyen un OCI ni prueban aislamiento/procedencia del publicador; simulan su
consulta de autorización y respuestas de Registry. No se probó conectividad,
permisos reales, CA de NAS, publicación real ni compatibilidad del piloto.
La API GET no consume permisos ni impide por sí sola replays: el publicador debe
serializar por run y prohibir sobrescrituras con otro digest. El worker no cancela
remotamente ni reenvía solicitudes inciertas. La conciliación operativa todavía
no tiene una interfaz propia y requiere revisar evidencia del operador.

Se conservaron los cambios anteriores. No se leyó/modificó `.env`, no se activó CI
en el entorno del usuario y no hubo commits. Los flags activos de pruebas sólo
existieron en procesos hijos con mocks loopback dentro de la red aislada.
La guía [ci-first-run.md](ci-first-run.md) separa preparación offline, revisión de
cola, activación futura autorizada y criterios de aceptación sin despliegue CD.
