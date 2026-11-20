# Atlas Wrapper

Atlas conserva el acceso por correo y contraseña y la vinculación individual con
GitHub. El desarrollador selecciona un repositorio y una rama; Atlas autoriza el
acceso, registra el commit y solicita CI a Woodpecker. El resultado de esta fase
es una imagen ARM64 verificada en el Registry de la NAS.

**CI y CD están separados. Esta versión no despliega aplicaciones ni se conecta
con Kubernetes.** El Kubero del clúster real se integrará posteriormente. Google
sigue siendo una opción visual deshabilitada.

## Integración y conexión

- [Contrato, variables y guía de conexión](docs/ci-integration.md).
- [Primera prueba real: preparación offline y comandos de habilitación](docs/ci-first-run.md).
- [Auditoría de dependencias y retirada del laboratorio](docs/ci-audit.md).
- [Flujo del proyecto](docs/project-flow.md).

La configuración central de Woodpecker y el publicador aislado son trabajo de
infraestructura externo. `ATLAS_CI_ENABLED=false` y
`ATLAS_CI_CENTRAL_READY=false` son los valores iniciales. Atlas no presume que la
Configuration Extension existe ni exige un pipeline en cada repositorio.

## Desarrollo del wrapper

Se necesitan Docker y, para las pruebas frontend/scripts, Node 22 o posterior.
Copiar `.env.example` a `.env` y configurar la GitHub App sólo cuando se autorice
utilizar GitHub real. No incluir secretos en Git.

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

La interfaz está en http://localhost:5173 y la API en http://localhost:3000/api.
Este Compose contiene únicamente frontend, backend, PostgreSQL y Redis. No
arranca k3d, Kubero, un registro local ni un ejecutor de despliegues.
El volumen `atlas-postgres` existente se conserva.

La migración 013 añade `ci_runs` e identificadores de registro idempotentes.
La 014 fija destino CI/Registry, autor y vencimiento por ejecución; las solicitudes
antiguas ya enviadas requieren conciliación si carecen de ese contexto.
Conserva todas las migraciones previas, proyectos, builds e imágenes históricas.
Los proyectos antiguos no se reconstruyen automáticamente.

## Pruebas aisladas

```sh
npm ci --prefix frontend
npm run build --prefix frontend
npm run lint --prefix frontend
node --test frontend/tests/api.test.cjs
npm ci --prefix scripts
npm test --prefix scripts
cd backend
cargo test --locked
```

Las pruebas unitarias TLS necesitan `openssl`. Las pruebas HTTP de integración
requieren PostgreSQL y opcionalmente Redis exclusivos para pruebas:

```sh
ATLAS_TEST_DATABASE_URL=postgres://postgres:test-only@localhost:5432/atlas_test_ci ATLAS_TEST_REDIS_URL=redis://localhost:6379 cargo test --locked -- --include-ignored --test-threads=1
```

La base debe comenzar con `atlas_test_`. `ci_integration.rs` inicia mocks locales
para GitHub, Woodpecker y Registry: no utiliza servicios reales, archivos de
pipeline ni secretos de infraestructura. Para aislar la red, ejecutar esta suite
en una red Docker `--internal` junto a PostgreSQL/Redis de pruebas.

La suite HTTP anterior conserva pruebas de autenticación, autorización y
operaciones de proyectos. Opcionalmente, `ATLAS_TEST_CLIENT=1` y las dependencias
frontend instaladas verifican también el proxy Vite con la API real de pruebas.

Los módulos Node históricos se conservan donde sus funciones se prueban mediante
dobles independientes del clúster. Sus comandos de infraestructura están
**desactivados**. No utilizar los antiguos scripts de arranque, construcción,
despliegue, eliminación o pruebas de laboratorio como parte de esta arquitectura.

## Estado de la primera prueba real

Pendiente de completar la configuración central, acordar el contrato del
publicador y recibir autorización para probar los servicios reales. Pasar los
mocks no acredita el criterio final de registrar un repositorio sin
`.woodpecker.yaml` y publicar su imagen en la NAS.
