# Atlas

Plataforma de proyectos de la Universidad del Norte, construida sobre Kubero.

## Estructura

- `frontend/`: aplicación React + TypeScript + Vite + Tailwind CSS.
- `backend/`: API Rust (Axum), PostgreSQL y Redis.
- `docs/`: requisitos, decisiones, arquitectura e identidad visual.
- `prototype/`: referencia HTML de los flujos diseñados antes de integrar el remoto.

## Desarrollo

```sh
cd frontend
npm ci
npm run dev
```

Vite publica el frontend en http://localhost:5173 y redirige `/api` y `/ws` al backend en el puerto 3000.

Para iniciar el backend, configura las variables de `backend/.env.example` y ejecuta `cargo run` desde `backend/`.

Si no tienes Rust instalado, puedes iniciar las dependencias y la API con Docker desde la raíz:

```powershell
Copy-Item .env.example .env
docker compose up --build postgres redis backend
```

Después utiliza **Usar backend local** en la pantalla de acceso. Puedes crear la primera cuenta desde el enlace **Crear cuenta local**.

### Integración con GitHub

Cada cuenta comienza sin GitHub vinculado. Al registrar un proyecto, el usuario debe autorizar la GitHub App antes de poder seleccionar uno de sus repositorios, una rama y el último commit disponible. El backend vuelve a validar el acceso antes de crear el proyecto.

Si ejecutas `cargo run`, configura en `backend/.env` los valores `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` y `FRONTEND_URL`. Si utilizas Docker Compose, copia `.env.example` a `.env` en la raíz y completa allí las credenciales.

En la configuración de la GitHub App activa **Request user authorization (OAuth) during installation** y registra `http://localhost:3000/api/github/callback` como Callback URL. La App solo necesita permisos de lectura sobre metadatos y contenidos; no configures una Setup URL para este flujo.

En desarrollo, `KUBERNETES_REQUIRED=false` permite iniciar la API y probar GitHub sin disponer todavía del clúster. Configúralo como `true` en los entornos donde las operaciones de infraestructura deban ser obligatorias.

### Demo local con Kind y dominio directo

El laboratorio local `../kubero` instala Kind, el operador de Kubero e Ingress. Antes de crear un proyecto, abre Docker Desktop y ejecuta desde este repositorio:

```powershell
.\scripts\start-local-kubero.ps1
```

El script enciende el contenedor Kind, PostgreSQL, Redis, el backend de Atlas, el frontend y un monitor local de despliegues. Comprueba que Kubernetes, la API y la página respondan. Esta instalación utiliza `kubero-control-plane` y ejecuta el backend en Docker; no necesita `kind-registry` ni otro `cargo run`. Al terminar, abre `http://127.0.0.1:5173/`, inicia sesión, vincula GitHub en el perfil y crea un proyecto con repositorio y rama. El monitor detecta los proyectos pendientes, los reclama por UUID y despliega cada uno automáticamente. Dos usuarios pueden registrar el mismo nombre: el UUID distingue los registros durante el despliegue y la URL usa el nombre normalizado. Si esa dirección ya existe, se agrega un sufijo numérico como `mi-portafolio-2`.

Para comprobar las aplicaciones existentes en Kubero:

```powershell
kubectl get kuberoapps -A
```

El monitor toma el repositorio y la rama guardados en Atlas, descarga el commit con la cuenta GitHub vinculada, construye un Dockerfile existente o genera una imagen NGINX para un sitio con `index.html`, importa la imagen en Kind y crea un `KuberoPipeline` y un `KuberoApp`. Solo después de comprobar una respuesta HTTP actualiza el proyecto a `running`. Si falla, marca el proyecto como `failed` y guarda el error en el historial de builds y en `.local/deployments/<UUID>.log`. El Ingress publica el puerto 80 de Kind, así que no se necesita `kubectl port-forward` ni mantener una terminal abierta para visitar la aplicación. El dominio `127.0.0.1.sslip.io` funciona solo desde el equipo que ejecuta Kind.

Para repetir manualmente un despliegue local durante el diagnóstico, usa el UUID del proyecto:

```powershell
.\scripts\deploy-local.ps1 -ProjectId <UUID>
```

La configuración de demo usa `compose.kubero.yaml` y un kubeconfig generado en `.local/`, excluido de Git. El token de GitHub se utiliza durante la descarga y no se inserta en la imagen ni en Kubernetes. El monitor local requiere acceso a Docker y a la base de datos de desarrollo; no se debe usar en producción. El modo de imagen local evita que el flujo GitOps del backend intente construir repositorios privados sin credenciales de Kubero.

### Integración con Kubero (PaaS)

Para la demo funcional con despliegues reales, necesitas:

1. **Cluster de Kubernetes con Kubero Operator instalado**
   - Instala el operador de Kubero siguiendo la [documentación oficial](https://kubero.dev/docs/installation)
   - Asegúrate de que el namespace `kubero-dev` existe (o configura `KUBERO_NAMESPACE`)

2. **Configuración del kubeconfig**
   - Local: Setea `KUBE_CONFIG_PATH` a la ruta de tu kubeconfig (ej: `~/.kube/config`)
   - In-cluster: El backend detecta automáticamente la configuración in-cluster
   - Docker: Monta tu kubeconfig como volumen en el contenedor

3. **Variables de entorno adicionales**
   - `DOMAIN_SUFFIX`: Dominio base para las aplicaciones (default: `estudiantes.cluster.local`)
   - `KUBERO_NAMESPACE`: Namespace donde se crean los CRDs (default: `kubero`)
   - `REGISTRY_URL`: URL del registry de contenedores (default: `192.168.1.201:5000`)

4. **Flujo de despliegue**
   - Al crear un proyecto, el backend crea automáticamente:
     - Un `KuberoPipeline` CRD con configuración de ingress
     - Un `KuberoApp` CRD con la configuración del repo/branch
   - Se dispara un build inicial mediante anotación
   - El frontend muestra el estado real del despliegue (phase, replicas, URL)
   - El estado se actualiza cada 10 segundos (polling)

Cuando se utiliza únicamente el frontend, el botón `Vincular GitHub (demo)` reproduce el estado inicial sin vinculación y habilita los repositorios de demostración sin comunicarse con GitHub.

## Documentación

- [Índice y estado de implementación](docs/README.md)
- [Decisiones del proyecto](docs/decisions.md)
- [Identidad de Atlas](docs/atlas-identity.md)
- [Flujo del proyecto](docs/project-flow.md)

El código importado del remoto es una base de implementación; todavía no cubre todos los requisitos definidos durante el prototipo.
