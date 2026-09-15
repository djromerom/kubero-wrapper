# Documentación de Atlas

## Definición vigente del producto

- [Requisitos funcionales](frequirements.md)
- [Requisitos no funcionales](non-frequirements.md)
- [Decisiones](decisions.md)
- [Flujo del proyecto](project-flow.md) y [diagrama](project-flow.png)
- [Backlog de segunda versión](second-ver.md)
- [Identidad visual](atlas-identity.md)

Los documentos en `requirements/`, `architecture/` y `api/` se conservaron del remoto como antecedentes técnicos. Ante discrepancias funcionales, revisar las decisiones y requisitos anteriores antes de implementar.

## Integración inicial · 8 de septiembre de 2026

Se integró `https://github.com/djromerom/kubero-wrapper.git`, conservando su historial y la rama main. Los documentos locales y el diagrama se movieron a esta carpeta. El prototipo se conserva como referencia; el desarrollo activo está en `frontend/`.

La aplicación existente recibió la identidad de Atlas. Esta integración visual no equivale a completar el MVP. Diferencias detectadas que requieren trabajo funcional:

- El remoto usa registro y contraseña propios; DEC-01 define identidad institucional.
- El remoto utiliza estados simplificados; DEC-09 separa admisión, CI, despliegue, URL y ciclo de vida.
- La eliminación remota es directa; las decisiones especifican confirmación, retención y solicitudes administrativas.
- La integración GitHub, admisión y actualizaciones en tiempo real deben alinearse con las decisiones.

No se han validado operaciones contra un backend o clúster en ejecución.

## Acceso de demostración
El botón Iniciar sesión con Microsoft muestra la elección de administrador o desarrollador y entra sin proveedor externo. El rol se conserva en sessionStorage por pestaña y se elimina al cerrar sesión. No se genera un token ni se envían peticiones al backend en modo demo. El catálogo incluye los proyectos de ejemplo del prototipo y conserva las solicitudes nuevas. Las operaciones que requieren servicios reales lo indican. /register redirige al acceso. La selección de rol es exclusiva de la demostración; no representa autorización institucional.

## Paneles recuperados del prototipo · 9 de septiembre de 2026

- **Mis proyectos:** seis ejemplos del desarrollador, contadores, correcciones pendientes y tarjetas con estado, repositorio, última ejecución y URL.
- **Clúster:** cinco nodos, CPU y memoria, evolución de recursos, almacenamiento, pods por estado, TLS, trabajos y auditoría. Son métricas estáticas del escenario de demostración, no telemetría real.
- **Proyectos de la plataforma:** trece ejemplos en total, cuatro pendientes iniciales, búsqueda y filtros. Las solicitudes muestran responsable, propósito, asignatura, rama y SHA.
- **Admisión:** validar exige escribir el repositorio; pedir correcciones exige una explicación. La aprobación pasa a CI pendiente y no simula un despliegue completado.
- **Detalle:** resumen, builds y logs de ejemplo, configuración e historial. El desarrollador puede presentar correcciones y volver a validación.
- **Eliminación demo:** solicitud administrativa con motivo, plazo y retención; eliminación voluntaria con confirmación del repositorio y retención. Recuperación pendiente y aviso de integración para exportaciones.
- **Notificaciones:** actividad del catálogo accesible desde la campana.

El catálogo demo se comparte entre perfiles en la misma pestaña, con visibilidad por propietario y catálogo global para administradores. Se conserva al cerrar sesión y cambiar de rol. Las solicitudes anteriores se migran desde el almacenamiento por rol. Otras pestañas tienen sesiones independientes.

Continúan pendientes las integraciones reales de identidad, GitHub, clúster, CI/CD, almacenamiento, exportaciones, cambios de configuración, recuperación efectiva, prórrogas y tareas automáticas de retención. La demo no modifica infraestructura.

Validación de la lógica demo: `node --test frontend/tests/demoProjects.test.cjs` desde la raíz del repositorio.
