# Decisiones del proyecto

## DEC-01 — Identidad, sesión y roles

- La autenticación se delega al proveedor institucional. El Wrapper no almacena contraseñas institucionales.
- La sesión institucional y la sesión del Wrapper son independientes. Cerrar sesión invalida inmediatamente solo la sesión y renovación del Wrapper.
- La sesión vence después de 2 horas de inactividad y tiene una duración máxima de 7 días.
- Los cambios o revocaciones de rol se aplican en un máximo de 5 minutos. El backend comprueba los permisos en cada operación protegida.
- Desarrolladores y administradores utilizan el mismo acceso y dashboard; el administrador dispone de una pestaña adicional.
- No existe autoasignación de roles.
- Se descartaron contraseñas propias, correo como prueba de identidad y GitHub como identidad principal porque duplican o no acreditan la identidad institucional.

## DEC-02 — Integración con GitHub

- Se utiliza una GitHub App separada de la autenticación institucional.
- Registrar y desplegar exige una cuenta de GitHub vinculada y un repositorio autorizado tanto para el usuario como para la aplicación.
- Permisos iniciales: `Metadata: read`, `Contents: read` y autorización en nombre del usuario.
- La integración puede obtener el repositorio, pero no modificar contenidos, administrar el repositorio, ejecutar deployments, modificar workflows ni gestionar webhooks.
- Una URL privada escrita manualmente no concede acceso.
- Desvincular GitHub conserva los proyectos y aplicaciones existentes, pero bloquea nuevos despliegues hasta recuperar un acceso válido.
- Se descartaron OAuth App, PAT y deploy keys como mecanismo principal por ofrecer permisos más amplios, menor control o peor gestión de identidad y rotación.

## DEC-03 — Registro y admisión inicial

- Un proyecto se registra con nombre, repositorio, rama, responsable institucional, propósito y commit presentado; al completar el registro pasa directamente a `PENDING_VALIDATION`.
- La justificación exige explicar el propósito funcional. Si es académico, se identifica la asignatura.
- El desarrollador presenta un commit mediante su SHA completo. La evidencia no cambia aunque avance la rama.
- La revisión administrativa solo se realiza antes del primer despliegue. Las actualizaciones posteriores pasan por CI/CD sin otra admisión.
- La revisión comprueba vinculación institucional, finalidad universitaria y funcionalidad real. No sustituye pruebas ni controles técnicos.
- Si el proyecto no cumple, pasa a `CORRECTIONS_PENDING` con explicación obligatoria. No existe rechazo definitivo ni límite funcional de intentos.
- Si hay un único administrador activo, puede aprobar su proyecto y la excepción se audita. Con dos o más, debe decidir otro administrador.

### Rúbrica propuesta

| Criterio | Condición |
| --- | --- |
| Vinculación institucional | El responsable es estudiante o funcionario vigente y está autorizado sobre el repositorio |
| Finalidad universitaria | Fue realizado para una asignatura o aporta un beneficio concreto a la Universidad |
| Funcionalidad real | Tiene al menos una función útil y verificable; una maqueta decorativa no basta |
| Claridad del alcance | Puede entenderse qué hace y cómo comprobarlo |
| Evidencia | El SHA corresponde al código consultado durante la admisión |

Los tres primeros criterios son obligatorios. La utilidad no se mide por cantidad de pantallas, volumen de código o sofisticación visual.

## DEC-04 — CI/CD

- Todo proyecto necesita admisión antes de desplegarse.
- Después de `APPROVED`, la versión pasa por CI y solo llega a CD si supera los controles obligatorios.
- Cada ejecución fija un SHA. Los resultados de otro commit no sirven para autorizar la versión candidata.
- Las actualizaciones posteriores siguen el mismo CI/CD sin repetir la admisión.
- `CI_FAILED` impide desplegar esa candidata, pero no revoca la admisión ni implica que una versión anterior haya caído.
- En `DEPLOY_FAILED`, un fallo de infraestructura permite reintentar el mismo artefacto; un fallo del proyecto exige un nuevo commit y otro CI.
- El motor, runners, controles, disparadores, artefactos, cuota y demás detalles de CI permanecen pendientes.

### Alternativas de CI por evaluar

1. GitHub Actions con runners alojados por GitHub.
2. GitHub Actions con runners institucionales aislados.
3. CI institucional orquestado por el Wrapper mediante workers separados.
4. Modelo híbrido.

La cuota de Actions en repositorios privados corresponde al propietario de cada repositorio. Los runners propios trasladan el coste y la seguridad del cómputo a la Universidad. Ninguna alternativa puede ejecutar código de estudiantes dentro del proceso API ni concederle credenciales administrativas del clúster.

## DEC-05 — Dominio, routing y TLS

- El usuario elige un subdominio único con el formato `<nombre>.<APP_BASE_DOMAIN>`.
- La parte elegida tiene entre 3 y 20 caracteres, solo minúsculas, números y guiones, sin guion inicial o final y sin nombres reservados como `admin`, `api`, `auth`, `www` y `status`.
- El hostname se reserva atómicamente. Ante conflicto se exige otro nombre; no se genera una alternativa automática.
- El Wrapper crea el routing y solicita el certificado mediante `cert-manager`, que lo obtiene, renueva y almacena en un Secret TLS.
- HTTP redirige a HTTPS.
- La URL solo queda lista cuando se cumplen `DNS_OR_PUBLICATION_READY + ROUTE_READY + TLS_READY + SERVICE_ENDPOINTS_READY`.

## DEC-06 — Despliegue y mantenimiento

- La admisión inicia automáticamente el primer flujo técnico; no se exige otro botón de despliegue.
- La candidata, su SHA, el resultado de CI/CD y la versión actualmente en servicio se registran por separado.
- Un nuevo commit vuelve a `CI_PENDING` sin otra revisión administrativa.
- El propietario puede cambiar el nombre visible y la rama. Cambiar la rama solo afecta procesos posteriores.
- El repositorio no puede sustituirse; otro repositorio constituye un proyecto nuevo.
- Los cambios de estado se envían al dashboard mediante SSE. Las acciones utilizan HTTP normal y el estado también puede consultarse tras una desconexión.

## DEC-07 — Colaboradores

- El desarrollador que despliega debe ser dueño del repositorio y puede invitar o retirar colaboradores institucionales.
- Como regla general, los colaboradores del Wrapper deben corresponder a colaboradores del repositorio.
- Invitaciones, aceptaciones, rechazos y retiros se auditan.

## DEC-08 — Eliminación y retención

### Eliminación iniciada por el desarrollador

- Solicitar y confirmar son acciones separadas. La confirmación explícita autoriza la retirada del servicio.
- Se bloquean trabajos nuevos, se cancelan los pendientes y los activos disponen de hasta 5 minutos para terminar antes de su cancelación forzada.
- Se detiene la aplicación, se retira el tráfico y se eliminan recursos efímeros exclusivos. No se eliminan el repositorio, las cuentas ni recursos compartidos.
- Los datos persistentes quedan `RETAINED` durante 15 días por defecto. Un administrador puede ampliar justificadamente el periodo a 30 días.

### Solicitud administrativa

- El administrador no elimina directamente. Registra un motivo, un plazo de 7, 14 o 21 días y una retención posterior de 15 o 30 días.
- Durante `DELETION_REQUESTED` la aplicación continúa funcionando.
- Se notifica al crear la solicitud. Los recordatorios son: 7 días → faltando 3 y 1; 14 días → 7, 3 y 1; 21 días → 14, 7, 3 y 1.
- El desarrollador puede confirmar la eliminación o solicitar una única prórroga justificada de 7, 14 o 21 días. Si se aprueba, se cuenta desde el vencimiento anterior.
- Si vence sin eliminación ni prórroga, el proyecto pasa a `SUSPENDED`, se detiene y sus datos pasan a `RETAINED`.

### Retención, recuperación y eliminación definitiva

- Los datos se conservan cifrados, aislados y con acceso restringido. Se intenta crear un snapshot cuando el almacenamiento lo permite; si no, se informa que el volumen original no es un respaldo adicional.
- El desarrollador puede exportar archivos como `.tar.gz` y bases de datos mediante el formato lógico nativo. La generación es asíncrona y el enlace autenticado vence en 24 horas. No se exportan secretos.
- Una eliminación voluntaria puede recuperarse sin aprobación administrativa. Una suspensión administrativa requiere justificación y aprobación de otro administrador.
- Una recuperación oportuna pausa la eliminación definitiva. Restaurar datos no devuelve tráfico hasta superar nuevamente el proceso técnico aplicable.
- Un administrador puede pausar la eliminación mediante una retención administrativa de hasta 30 días renovable o una retención legal con revisión periódica. Ninguna reactiva la aplicación.
- Exportaciones, snapshots y recuperaciones realizan hasta tres intentos con espera exponencial antes de requerir intervención administrativa.
- Al terminar la retención, la eliminación definitiva es automática, no requiere una segunda aprobación y no puede adelantarse. Se bloquea por recuperación pendiente, exportación en curso o retención administrativa o legal.
- Los fallos parciales mantienen el caso abierto hasta verificar todos los recursos. Entonces pasa a `DELETED`.
- La auditoría del caso se conserva 12 meses después de cerrarlo.

## DEC-09 — Estados

Los estados se separan por dimensión:

- Admisión: `PENDING_VALIDATION`, `CORRECTIONS_PENDING`, `APPROVED`.
- CI: `NOT_STARTED`, `PENDING`, `RUNNING`, `PASSED`, `FAILED`.
- Despliegue: `NOT_DEPLOYED`, `PENDING`, `DEPLOYING`, `DEPLOYED`, `FAILED`.
- URL: `NOT_READY`, `PROVISIONING`, `READY`, `FAILED`.
- Ciclo de vida: `ACTIVE`, `DELETION_REQUESTED`, `SUSPENDED`, `RETAINED`, `DELETED`.

Un proyecto puede conservar una versión `DEPLOYED` mientras otra candidata tiene CI `FAILED`.

## DEC-10 — Requisitos no funcionales

- Secretos cifrados o custodiados por el gestor de secretos; nunca en URLs, errores, SSE, logs, auditoría o exportaciones.
- Disponibilidad mensual del Wrapper del 99 %. Mantenimiento programado: aviso de 24 horas y máximo de 4 horas mensuales.
- Latencia p95: 500 ms para operaciones síncronas normales y 1 segundo para listas y detalles. Las operaciones largas son asíncronas.
- El 95 % de los eventos SSE llega en un máximo de 2 segundos.
- Capacidad mínima: 50 usuarios activos, 100 proyectos registrados, 30 aplicaciones según capacidad del clúster y 10 ejecuciones concurrentes de CI/CD; el exceso se encola.
- Dependencias externas: 10 segundos por intento y hasta tres intentos exponenciales para operaciones seguras o idempotentes.
- Respaldo cifrado del Wrapper cada 24 horas, `RPO` de 24 horas, `RTO` de 4 horas, conservación de 30 días y prueba trimestral.
- Logs operativos durante 30 días y alertas críticas en un máximo de 5 minutos desde la detección.
- Interfaz conforme con WCAG 2.2 AA, utilizable desde 360 píxeles y compatible con la versión vigente y anterior de Chrome, Edge y Firefox.
- Entrega del backend como imagen OCI; configuración externa, pruebas de flujos críticos, migraciones versionadas, dependencias reproducibles y reversión en 30 minutos cuando sea posible.
- La trazabilidad se conserva mientras exista el proyecto y durante 12 meses después de su cierre o eliminación definitiva.

## Decisiones pendientes

### CI/CD

1. Elegir motor y ubicación de ejecución: GitHub Actions alojado, runners institucionales, CI propio o híbrido.
2. Definir quién posee y paga la cuota, estimar minutos y almacenamiento y decidir qué ocurre al agotarlos.
3. Definir los controles obligatorios y cómo impedir que un workflow modificable por el desarrollador se considere evidencia institucional suficiente.
4. Elegir el disparador de actualizaciones: push, solicitud manual u otro evento.
5. Definir aislamiento, credenciales, red, límites y ciclo de vida de runners o workers que ejecutan código no confiable.
6. Definir formato, firma o digest, almacenamiento y retención de artefactos y logs.
7. Definir reintentos del mismo SHA, cancelación, orden de ejecuciones y tratamiento de eventos duplicados.

### Otras decisiones del MVP

1. Confirmar con TI el proveedor, protocolo y configuración de autenticación institucional, incluido el segundo factor.
2. Elegir la fuente de autoridad del rol administrador, su responsable, el alta inicial y el procedimiento de revocación.
3. Aprobar o modificar definitivamente la rúbrica de admisión propuesta.
4. Definir `APP_BASE_DOMAIN`, la implementación de routing y el `Issuer` o `ClusterIssuer` de `cert-manager`.
5. Definir el criterio exacto de salud de un despliegue y cuándo puede considerarse `DEPLOYED` y con URL lista.
6. Definir reintentos de despliegue, rollback, orden de despliegues concurrentes y si se mantiene siempre la última versión saludable.
7. Definir el tratamiento de cambios de configuración y secretos durante una actualización.
8. Definir alertas y responsables de incidentes de despliegue, certificados e infraestructura.
9. Definir qué ocurre cuando el propietario pierde acceso a GitHub o su vínculo institucional.
10. Decidir si el subdominio puede cambiar, quién lo autoriza y qué ocurre con la URL anterior.
11. Definir cómo se verifican colaboradores cuando el proyecto utiliza varios repositorios.
12. Diseñar la transferencia de propiedad y el tratamiento de proyectos sin responsable elegible.
13. Confirmar plataforma objetivo: arquitectura de CPU, versiones de Kubernetes y tecnologías de persistencia y mensajería.

### Segunda versión

1. Reconstrucción manual y consulta de logs.
2. Pausa y reanudación voluntaria.
3. Variables de entorno y secretos administrables por proyecto.
4. Límites de recursos, cuotas y rate limiting.
5. Vista administrativa general de auditoría.
6. Limpieza de artefactos y builds antiguos.
