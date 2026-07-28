# Functional Requirements

## Students

| ID | Description | Priority |
|----|-------------|----------|
| RF-01 | Registrarse con email + password (o GitHub OAuth) | MVP |
| RF-02 | Login y obtener JWT | MVP |
| RF-03 | Crear proyecto (nombre, repo git URL, branch) | MVP |
| RF-04 | Ver lista de proyectos con estado (building, running, failed) | MVP |
| RF-05 | Ver detalle del proyecto (URL, logs del build, estado en vivo) | MVP |
| RF-06 | Eliminar proyecto (destruye pipeline + app en Kubero) | MVP |
| RF-07 | Ver webhook URL + secret para configurar en su repo | MVP |
| RF-20 | Rebuild manual (sin git push) | V2 |
| RF-22 | Ver logs de la app corriendo (runtime) | V2 |
| RF-24 | Pausar/reanudar app (scale to 0) | V2 |
| RF-30 | Variables de entorno configurables por proyecto | V2 |

## Admin

| ID | Description | Priority |
|----|-------------|----------|
| RF-08 | Ver todos los proyectos de todos los estudiantes | MVP |
| RF-09 | Ver estado del cluster (nodos, pods, recursos) | MVP |
| RF-10 | Suspender/eliminar proyecto de cualquier estudiante | MVP |
| RF-15 | Asignar límites de recursos por estudiante | V2 |
| RF-26 | Cuotas globales (máx proyectos por estudiante) | V2 |
| RF-29 | Logs de auditoría | V2 |

## System

| ID | Description | Priority |
|----|-------------|----------|
| RF-11 | Recibir webhook de GitHub/GitLab y triggerear build en Kubero | MVP |
| RF-12 | Notificar al dashboard en tiempo real (WebSocket) | MVP |
| RF-13 | Limpiar builds fallidos viejos automáticamente | V2 |
| RF-14 | Asignar dominio `<proyecto>.estudiantes.cluster.local` | MVP |
| RF-34 | Health check endpoint (`/health`) | MVP |
| RF-36 | Rate limiting por estudiante (máx N builds/hora) | V2 |

## Event Flow (MVP)

```
project.created  → Kubero Manager → create Pipeline + App CRD
pipeline.ready   → Dashboard       → show "ready"
webhook.received → Build Manager   → trigger Kubero build
build.started    → Dashboard       → show "building"
build.completed  → Dashboard       → show URL + status
build.failed     → Dashboard       → show error
```