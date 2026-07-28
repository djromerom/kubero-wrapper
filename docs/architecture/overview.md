# Architecture Overview

## Event-Driven Design

```
                     ┌──────────────────┐
                     │   React Dashboard│
                     └────────┬─────────┘
                              │ WebSocket (SSE)
┌─────────────────────────────▼─────────────────────────────┐
│                    Rust API (Axum)                        │
│                                                           │
│  publish: project.created, build.started, build.completed │
│  subscribe: pipeline.ready, deployment.done               │
└─────────────────────────────┬─────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   Redis Pub/Sub  │
                    └──┬──────┬──────┬──┘
                       │      │      │
              ┌────────▼┐ ┌──▼───┐ ┌▼────────┐
              │ Proyectos│ │Kubero│ │WebSocket│
              │ Manager  │ │Mgr   │ │Broadcast│
              └──────────┘ └──────┘ └─────────┘
```

## Components

### Rust Backend (Axum)
- HTTP API REST
- WebSocket handler for real-time events
- Redis Pub/Sub for event bus
- PostgreSQL via SQLx

### React Dashboard
- Login / Register
- Project CRUD
- Real-time status via WebSocket
- Admin panel

### Event Bus (Redis)
- Async Pub/Sub
- Decouples API from Kubero operations
- Allows future subscribers (email notifications, metrics)

## Data Flow

```
1. Student creates project → POST /api/projects
2. API publishes project.created → Redis
3. Kubero Manager subscribes → creates CRDs in Kubernetes
4. CRD ready → Kubero Manager publishes pipeline.ready → Redis
5. API receives → broadcasts via WebSocket to dashboard
6. Git push → GitHub sends webhook → POST /api/webhooks
7. API publishes webhook.received → Redis
8. Build Manager subscribes → triggers build in Kubero
9. Build completes → Kubero Manager publishes build.completed → Redis
10. API broadcasts via WebSocket → dashboard updates
```

## Stack

| Component | Technology |
|-----------|-----------|
| Backend | Rust + Axum + tokio |
| Database | PostgreSQL 16 |
| Event Bus | Redis 7 |
| Frontend | React + Vite |
| HTTP | Axum (TLS via Traefik) |
| Auth | JWT (jsonwebtoken + argon2) |