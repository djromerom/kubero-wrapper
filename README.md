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
