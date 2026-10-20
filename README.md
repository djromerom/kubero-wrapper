# Atlas

Plataforma de proyectos de la Universidad del Norte, construida sobre Kubero.

## Estructura

| Directorio | Responsabilidad |
| --- | --- |
| `frontend/` | React, TypeScript, Vite y Tailwind CSS 4 |
| `backend/` | API Rust, PostgreSQL y Redis; [desarrollo del backend](#backend) |
| `scripts/` | Adaptación, construcción, servicios y despliegue del laboratorio |
| `infra/` | Laboratorio K3s y adaptación del constructor del operador Kubero |
| `docs/` | Actores, flujo del proyecto y requisitos en reconciliación |

## Trabajar en local con el ejecutor

### Primera vez en otro equipo

1. Clonar el repositorio y cambiar a la rama `testing`.
2. Instalar Docker Desktop con contenedores Linux, Node.js 22 o posterior, `kubectl` y `k3d`, disponibles desde la terminal.
3. Abrir Docker Desktop y esperar a que su motor esté listo. Dejar libres los puertos 80, 443, 3000, 5173, 5433, 6379 y 6550.
4. Desde la raíz del repositorio, copiar la configuración:

```powershell
Copy-Item .env.example .env
```

Editar `.env`: asignar un `JWT_SECRET` aleatorio y configurar los valores de la GitHub App indicados en [GitHub y autenticación](#github-y-autenticación). Este archivo contiene secretos y no se sube a Git.

Después, preparar el laboratorio y arrancar Atlas con su ejecutor:

```powershell
npm ci --prefix scripts
node scripts/setup-k3s.mjs
node scripts/start-local-kubero.mjs --build
```

La preparación crea el clúster local K3s dentro de Docker mediante k3d e instala Kubero y su registro de imágenes. El primer arranque puede tardar mientras descarga y construye las imágenes. Abrir [Atlas](http://localhost:5173), registrar una cuenta y vincular GitHub. Cada equipo tiene sus propios usuarios, proyectos, imágenes y clúster: estos datos y la carpeta `.local/` no se descargan con el repositorio. Para probar la aprobación también se necesita una cuenta con rol de administrador en esa base local.

### Cada día

Abrir Docker Desktop, esperar a que esté listo y ejecutar desde la raíz:

```powershell
node scripts/start-local-kubero.mjs
```

El comando inicia el clúster existente, comprueba Kubero, levanta frontend, API, PostgreSQL y Redis, y deja activo el **ejecutor** en segundo plano. No hace falta iniciar manualmente cada contenedor de k3d ni levantar primero `kubero-wrapper`.

El ejecutor procesa los proyectos aprobados: construye su Dockerfile, publica la imagen en el registro local y despliega con Kubero. También procesa las solicitudes de eliminación y confirma la retirada de recursos e imágenes antes de ocultar el proyecto. Debe estar activo para completar ambas operaciones; los logs quedan en `.local/deploy-worker.out.log` y `.local/deploy-worker.err.log`.

Los cambios del frontend se reflejan automáticamente. Después de modificar el backend, las dependencias o cambiar de rama, reconstruir con:

```powershell
node scripts/start-local-kubero.mjs --build
```

`--build-backend` es actualmente un alias de `--build`: reconstruye también el frontend. Si cambian las dependencias de `scripts/`, repetir `npm ci --prefix scripts`.

Para esta prueba usar el arranque normal, **sin `--without-worker`**. Esa opción permite entrar a Atlas sin iniciar el ejecutor; si no hay otro activo, las aprobaciones y eliminaciones quedan pendientes. Tampoco detiene un ejecutor que ya estuviera iniciado.

## Desarrollo con Docker sin el laboratorio completo

Los comandos de esta sección levantan la interfaz y la API por separado. Para probar el flujo de aprobación, despliegue y eliminación, utilizar el ejecutor de la sección anterior.

Copiar `.env.example` a `.env`, configurar la GitHub App y ejecutar desde la raíz:

```sh
docker compose up -d --build
```

El frontend queda en `http://localhost:5173` y la API en `http://localhost:3000/api`. El frontend compilado se sirve con NGINX, que dirige `/api` al backend. Para actualizar el código del backend hay que reconstruir su imagen:

```sh
docker compose up -d --build backend
```

### Frontend con recarga automática

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d --build --renew-anon-volumes frontend
```

Vite comparte el código con el contenedor y utiliza polling para detectar cambios desde Windows. Las dependencias Linux se mantienen en un volumen separado de los `node_modules` del equipo. Repetir el comando si cambia `package.json` o el lockfile. Para detener este modo, incluir ambos archivos Compose.

Para volver a NGINX:

```sh
docker compose up -d --build --no-deps frontend
```

También puede ejecutarse Vite en el equipo: detener el contenedor frontend, dejar backend y servicios activos y ejecutar desde `frontend/`:

```sh
npm ci
npm run dev
```

Ambos modos usan el puerto 5173 y no pueden ejecutarse a la vez. Vite redirige `/api` a `localhost:3000` por defecto; en Docker se configura `VITE_API_PROXY_TARGET=http://backend:3000`.

## Interfaz

El código se organiza en `frontend/src/login/`, `sidebar/`, `content/` y `shared/`. `App.tsx` define las rutas; `Layout.tsx` compone la interfaz. Navegación, paneles de cuenta y animación de la barra lateral están separados en sus componentes.

Los tokens visuales y estilos globales están en `frontend/src/index.css`, el isotipo en `shared/AtlasBrand.tsx` y la composición de acceso en `login/AuthLayout.tsx`.

Convenciones existentes: cada etiqueta de apertura JSX conserva sus atributos en una línea; elementos anidados, bloques de lógica y handlers largos se separan para facilitar la lectura. Autenticación, proyectos y GitHub utilizan el backend real. Las vistas detalladas del clúster y las notificaciones siguen pendientes.

## Backend

API Rust con Axum y Tokio. SQLx conecta PostgreSQL y aplica las migraciones al iniciar. Redis recibe eventos de la plataforma; Kubernetes/Kubero gestiona recursos cuando existe una configuración válida.

### Desarrollo

Requiere Rust estable, PostgreSQL y Redis. Desde la raíz:

```sh
docker compose up -d postgres redis
```

Desde `backend/`, ejemplo para los puertos del Compose local:

```powershell
$env:DATABASE_URL = 'postgres://postgres:postgres@localhost:5433/kubero_wrapper'
$env:REDIS_URL = 'redis://localhost:6379'
$env:JWT_SECRET = 'configura-un-valor-local-aleatorio'
$env:KUBERNETES_REQUIRED = 'false'
cargo run --locked
```

`dotenvy` también carga `backend/.env` si existe. Para vincular GitHub se necesitan las variables de la App enumeradas en `.env.example` de la raíz. Los secretos se suministran por entorno o archivos locales excluidos de Git.

### Configuración

| Variables | Uso |
| --- | --- |
| `DATABASE_URL`, `REDIS_URL` | Persistencia y eventos |
| `JWT_SECRET`, `JWT_EXPIRY_HOURS` | Firma y duración del JWT local; duración por defecto: 24 horas |
| `HOST`, `PORT` | Escucha HTTP; por defecto `0.0.0.0:3000` |
| `FRONTEND_URL` | Origen al que regresa la autorización de GitHub |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` | GitHub App y OAuth de vinculación |
| `KUBERNETES_REQUIRED`, `KUBE_CONFIG_PATH` | Exigir Kubernetes o permitir iniciar la API sin clúster |
| `KUBERO_NAMESPACE`, `DOMAIN_SUFFIX`, `REGISTRY_URL` | Recursos y publicación de aplicaciones |
| `EXTERNAL_IMAGE_DEPLOYMENT`, `LOCAL_IMAGE_DEPLOYMENT` | Delegar al worker el despliegue de imágenes verificadas |

`GET /api/health` comprueba PostgreSQL. La separación de sondas liveness/readiness/startup está pendiente. Las rutas están en `src/routes.rs`; GitHub tiene sus handlers en `src/github.rs`.

### Pruebas

```sh
cargo test --locked
cargo build --locked
```

La integración requiere una base PostgreSQL aislada creada previamente y Redis. Su nombre debe comenzar por `atlas_test_`; la suite se solicita explícitamente:

```powershell
$env:ATLAS_TEST_DATABASE_URL = 'postgres://postgres:postgres@localhost:5433/atlas_test_backend'
$env:ATLAS_TEST_REDIS_URL = 'redis://localhost:6379'
cargo test --locked --test http_integration -- --ignored --nocapture
```

La suite inicia el backend compilado, aplica migraciones y verifica HTTP, autenticación, permisos y aprobación administrativa sin una imagen previa. Limpia sus usuarios de prueba y detiene el servidor al terminar.

Para incluir el cliente TypeScript, instalar antes sus dependencias con `npm ci` desde `frontend/`, disponer de Node y establecer `ATLAS_TEST_CLIENT=1`. Se ejecutará `frontend/tests/api.integration.cjs`, que inicia Vite y realiza peticiones reales a través de su proxy.

La autenticación institucional, SSE y el ciclo de vida completo siguen pendientes.

## GitHub y autenticación

El desarrollo actual utiliza registro y contraseña locales con JWT. La autenticación institucional definida en los issues todavía debe implementarse.

La vinculación de GitHub es independiente mediante GitHub App. Configurar en `.env` los valores de `.env.example`. En la App se utiliza **Request user authorization (OAuth) during installation** y el callback `http://localhost:3000/api/github/callback`. El flujo implementado solicita lectura de metadatos y contenidos.

Atlas consulta repositorios y ramas autorizados y resuelve automáticamente el último commit; el desarrollador no elige un SHA. La futura transferencia de repositorios y el aprovisionamiento de CI deben cerrar su política de permisos antes de implementarse.

## Laboratorio de despliegue

El laboratorio utiliza K3s mediante k3d en Docker Desktop. Los pasos de preparación y arranque están en [Trabajar en local con el ejecutor](#trabajar-en-local-con-el-ejecutor). Desde la raíz:

```sh
npm ci --prefix scripts
node scripts/setup-k3s.mjs
node scripts/start-local-kubero.mjs
```

El script comprueba K3s y Kubero, y levanta frontend, API, PostgreSQL y Redis mediante `compose.yaml`, `compose.kubero.yaml` y `compose.dev.yaml`. El frontend de desarrollo se ejecuta dentro de Docker. `--build` reconstruye las imágenes y renueva el volumen de dependencias del frontend después de cambiar de rama. `--without-worker` permite comprobar el acceso a Atlas sin iniciar el monitor de despliegues.

Al pulsar **Eliminar**, la API devuelve `202` y mantiene el proyecto visible mientras el ejecutor retira sus recursos de Kubero y Atlas, verifica su ausencia y elimina las versiones de su imagen del registro local y de la caché de K3s. Solo después lo marca como eliminado. Los errores quedan visibles y se puede reintentar; si el ejecutor está detenido, la solicitud queda pendiente. No se puede eliminar durante una construcción. Este flujo está disponible para el laboratorio `k3d-atlas`.

La limpieza del registro suspende temporalmente sus escrituras para ejecutar la recolección de capas sin referencias. Las aplicaciones publicadas siguen atendiendo. Un bloqueo compartido impide solapar construcciones de Atlas y limpiezas. Para retirar una imagen de prueba sin proyecto, comprobando antes que no está referenciada:

```sh
node scripts/delete-local.mjs --image-repository native-check-680a4d70
```

Las solicitudes nuevas y los reenvíos quedan pendientes de validación administrativa. El administrador puede pedir correcciones o aprobar sin exigir una imagen construida previamente. El monitor solo reclama proyectos admitidos y aprobados; construye el Dockerfile del commit presentado, despliega la imagen mediante Kubero y comprueba su disponibilidad antes de marcar el proyecto como desplegado. Esta prueba requiere un Dockerfile en la raíz y no ejecuta empaquetado automático, CI ni transferencia del repositorio.

Los fallos técnicos quedan en los logs del proyecto y permiten reintentar sin repetir la admisión. Guardar configuración durante las correcciones conserva las observaciones hasta que el estudiante reenvía la solicitud. La migración 008 devuelve a revisión las solicitudes que seguían esperando la adaptación del flujo anterior.

Para diagnosticar un despliegue:

```sh
node scripts/deploy-local.mjs --project-id <UUID>
kubectl --kubeconfig .local/k3s.kubeconfig --context k3d-atlas get kuberoapps -A
```

Los logs y kubeconfigs quedan en `.local/`. El dominio `127.0.0.1.sslip.io` sirve únicamente desde el equipo que ejecuta el laboratorio. K3s utiliza Traefik y la clase de almacenamiento `local-path`.

`compose.cluster.yaml` permite un clúster externo mediante `ATLAS_KUBECONFIG_FILE`, `ATLAS_DOMAIN_SUFFIX` y `ATLAS_IMAGE_REGISTRY`; el worker utiliza los ajustes de `scripts/cluster-settings.mjs`. El laboratorio todavía no completa el modelo de transferencia, CI de proyectos y retirada del flujo objetivo.

## Pruebas y CI

Desde `frontend/`:

```sh
npm test
npm run lint
npm run build
```

Las pruebas unitarias del cliente simulan respuestas HTTP. La integración ejecuta el cliente real a través del proxy Vite contra backend Rust y PostgreSQL aislados. Sus comandos están en la sección [Backend](#backend).

Los workflows de CI están preparados localmente, pero su incorporación al repositorio sigue pendiente. Cubren:

- `backend.yaml`: pruebas Rust, integración HTTP y del cliente con PostgreSQL/Redis temporales y compilación.
- `frontend.yaml`: lint, pruebas unitarias, compilación TypeScript/Vite y artefacto del frontend.
- `scripts.yaml`: pruebas Node de adaptación, construcción Kubero y automatización en Linux y Windows.

Las pruebas de servicios y construcción con Kubernetes requieren infraestructura y no se ejecutan en esos workflows. El CI de Atlas y el CI de proyectos alojados son ámbitos independientes.

## Modelo y seguimiento

- [Actores](docs/Actors.md) y [flujo del proyecto](docs/project-flow.md): modelo objetivo; algunas etapas todavía no están implementadas en el laboratorio.
- [Issues](https://github.com/djromerom/kubero-wrapper/issues): seguimiento de requisitos y trabajo pendiente.
- [Requisitos funcionales](docs/requirements/functional.md) y [no funcionales](docs/requirements/non-functional.md): documentos en reconciliación con los issues.
- [Segunda versión](https://github.com/djromerom/kubero-wrapper/issues/23): backlog V2 y propuesta de colaboradores.
