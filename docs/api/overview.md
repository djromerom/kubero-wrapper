# API Overview

## Base URL

```
https://wrapper.cluster.local/api
```

## Authentication

```
Authorization: Bearer <jwt_token>
```

## Endpoints (MVP)

### Auth
```
POST   /api/auth/register          # Registro
POST   /api/auth/login             # Login → JWT
POST   /api/auth/refresh           # Refresh token
```

### Projects
```
GET    /api/projects               # Listar mis proyectos
POST   /api/projects               # Crear proyecto
GET    /api/projects/:id           # Detalle del proyecto
DELETE /api/projects/:id           # Eliminar proyecto
POST   /api/projects/:id/rebuild   # Rebuild manual
```

### Builds
```
GET    /api/projects/:id/builds    # Historial de builds
GET    /api/projects/:id/builds/:bid/logs  # Logs del build
```

### Webhooks
```
POST   /api/webhooks/:project_id   # Recibir webhook de git
```

### Admin
```
GET    /api/admin/projects         # Todos los proyectos
GET    /api/admin/cluster          # Estado del cluster
DELETE /api/admin/projects/:id     # Eliminar proyecto (admin)
```

### WebSocket
```
WS     /api/ws/projects/:id        # Eventos en vivo del proyecto
WS     /api/ws/admin               # Eventos globales (admin)
```

## Event Payloads

```json
{
  "event": "build.completed",
  "project_id": "uuid",
  "data": {
    "status": "success",
    "url": "https://mi-app.estudiantes.cluster.local",
    "timestamp": "2026-07-28T18:00:00Z"
  }
}
```