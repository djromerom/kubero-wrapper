# Non-Functional Requirements

| ID | Description | Target |
|----|-------------|--------|
| RNF-01 | Multi-tenant aislado — estudiante A no ve proyectos de B | RBAC + namespaces |
| RNF-02 | Compila y corre nativo en ARM64 (Orange Pi 5 Plus) | Rust target `aarch64-unknown-linux-gnu` |
| RNF-03 | Consumo de RAM | < 256MB por instancia del backend |
| RNF-04 | Latencia de API | < 200ms (p95) |
| RNF-05 | Estados en vivo vía WebSocket | latencia < 1s |
| RNF-06 | Un solo binario deployable | Rust compile |
| RNF-07 | Datos persistentes | PostgreSQL via Longhorn PVC |
| RNF-08 | Eventos no bloqueantes | Redis Pub/Sub con retry |
| RNF-09 | Capacidad para 50+ estudiantes simultáneos | Horizontal scaling |
| RNF-10 | HTTPS en todos los endpoints | cert-manager + Traefik |