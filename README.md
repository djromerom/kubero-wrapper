# Kubero Wrapper

Multi-tenant PaaS wrapper for [Kubero](https://www.kubero.dev). Event-driven backend in Rust + React dashboard for students.

## Architecture

```
Student Browser → React Dashboard → Rust API (Axum) → Redis (Event Bus)
                                                          ↓
                                               ┌──────────┼──────────┐
                                               ↓          ↓          ↓
                                         Projects    Kubero      Notify
                                         Manager     Manager
                                               ↓          ↓
                                          PostgreSQL  Kubero CRDs
```

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite |
| Backend | Rust (Axum + tokio) |
| Event Bus | Redis (Pub/Sub) |
| Database | PostgreSQL (via Longhorn) |
| Runtime | ARM64 (Orange Pi 5 Plus) |

## Quick Start

```bash
# Backend
cargo run

# Frontend
cd frontend && npm run dev
```

## Documentation

- [Requirements](docs/requirements/)
- [Architecture](docs/architecture/)
- [API](docs/api/)