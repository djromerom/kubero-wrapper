# Flujo completo de un proyecto en el Wrapper

## 1. Principios del flujo

- El Wrapper no crea ni modifica el repositorio. La GitHub App se utiliza con permisos de lectura para consultar los repositorios autorizados y obtener su contenido.
- La identidad institucional y la sesión del Wrapper son independientes. Cerrar sesión invalida únicamente la sesión del Wrapper.
- La revisión administrativa ocurre una sola vez y decide la admisión institucional del proyecto. No aprueba cada commit ni sustituye las comprobaciones técnicas.
- Cada versión procesada se identifica mediante el SHA completo de su commit. La rama puede avanzar, pero el SHA fija exactamente el código evaluado en una ejecución.
- Después de la admisión, cada actualización recorre CI/CD sin repetir la revisión administrativa.
- CI y despliegue son etapas diferentes: CI comprueba y construye una versión; el despliegue intenta ejecutarla en la infraestructura.
- Los estados se separan por dimensión. Un proyecto puede estar admitido, conservar una versión desplegada y tener al mismo tiempo una nueva candidata con CI fallido.

## 2. Registro del proyecto

### 2.1. Punto de partida

El código ya existe en un repositorio de GitHub. El desarrollador inicia sesión en el Wrapper, vincula su cuenta de GitHub mediante la GitHub App y selecciona un repositorio al que tengan acceso tanto la integración como el propio usuario.

La integración solicita únicamente lectura de metadatos y contenidos. No escribe commits, no modifica workflows y no administra el repositorio.

### 2.2. Datos registrados

Para registrar el proyecto se indican:

- nombre visible;
- repositorio;
- rama inicial;
- responsable institucional;
- propósito funcional y asignatura, cuando corresponda;
- commit presentado como evidencia.

El backend verifica que los datos obligatorios estén presentes, que el repositorio esté autorizado, que la rama exista y que el commit corresponda a ambos. Al completar correctamente el registro se crea también la primera solicitud de admisión y el proyecto pasa directamente a `PENDING_VALIDATION`. Todavía no puede desplegarse.

## 3. Solicitud de admisión

Durante el registro, el desarrollador selecciona un commit de la rama configurada. El Wrapper propone el último disponible, pero permite escoger otro commit válido.

Al completar el registro, el servidor comprueba que el commit pertenece al repositorio y a la rama indicados y que puede obtenerse. Después registra de forma inmutable:

- proyecto, repositorio y rama;
- SHA completo del commit;
- propósito y asignatura, cuando corresponda;
- solicitante y fecha.

El proyecto pasa a `PENDING_VALIDATION`. Un push posterior no cambia el commit presentado: si la rama avanza, la solicitud continúa vinculada al SHA original.

## 4. Revisión administrativa

La revisión determina si el proyecto puede utilizar la infraestructura universitaria. El administrador consulta la justificación, el historial y el código correspondiente al SHA presentado.

La admisión comprueba tres condiciones obligatorias:

1. **Vinculación institucional:** el responsable es un estudiante o funcionario vigente y está autorizado sobre el repositorio.
2. **Finalidad universitaria:** el proyecto fue realizado para una asignatura o aporta un beneficio concreto a la Universidad.
3. **Funcionalidad real:** existe una función útil y verificable; una maqueta puramente decorativa no es suficiente.

La revisión no es una auditoría técnica exhaustiva. Las pruebas, el análisis y la construcción pertenecen al CI.

### 4.1. `CORRECTIONS_PENDING`

Si alguna condición no se cumple, el administrador solicita correcciones y debe explicar el motivo. No existe un rechazo definitivo.

El desarrollador consulta las observaciones, realiza fuera del Wrapper los cambios de código o justificación que correspondan y presenta una nueva solicitud seleccionando el commit que contiene la corrección. La nueva solicitud vuelve a `PENDING_VALIDATION` y conserva el vínculo con el historial anterior; no se sobrescriben las observaciones, decisiones ni SHA previos.

Este ciclo puede repetirse las veces necesarias durante la admisión inicial.

### 4.2. `APPROVED`

Si el proyecto cumple las condiciones, queda `APPROVED`. Se registran el administrador, la fecha, la solicitud evaluada y el SHA presentado como evidencia.

Si existe un solo administrador activo, puede aprobar su propio proyecto y la excepción queda auditada. Si existen dos o más, el solicitante no puede aprobar el suyo y debe decidir otro administrador.

La aprobación corresponde al proyecto y solo se necesita la primera vez. A partir de este punto, los nuevos commits no vuelven a revisión administrativa.

## 5. Integración continua (CI)

Después de `APPROVED`, la versión objetivo pasa a `CI_PENDING`. En las actualizaciones posteriores, un nuevo commit del proyecto admitido regresa igualmente a esta etapa.

La herramienta concreta, los controles obligatorios y el disparador del CI siguen pendientes de decisión. Independientemente de la implementación elegida, la ejecución debe quedar asociada a un SHA exacto.

### 5.1. `CI_PENDING`

La versión espera que comience su ejecución de CI. Estar pendiente no significa que haya superado comprobaciones ni que pueda desplegarse.

### 5.2. `CI_RUNNING`

El CI ejecuta las comprobaciones técnicas definidas, como pruebas, análisis y construcción del artefacto. Los resultados y logs autorizados se relacionan con el SHA objetivo.

### 5.3. `CI_FAILED`

Si una comprobación falla, la candidata pasa a `CI_FAILED` y no puede continuar al despliegue. El fallo no revoca `APPROVED` ni implica necesariamente que la versión que ya estaba en servicio haya dejado de funcionar.

Cuando el problema pertenece al código o a la configuración del proyecto, el desarrollador lo corrige en el repositorio y genera un nuevo commit. Ese nuevo SHA crea otra ejecución desde `CI_PENDING`.

Un simple reintento del mismo SHA solo tiene sentido si la política finalmente acordada lo permite y la causa es transitoria; esta regla continúa pendiente junto con la decisión general de CI.

### 5.4. `CI_PASSED`

Cuando la versión supera todos los controles obligatorios, pasa a `CI_PASSED`. Este resultado autoriza el inicio del CD para ese SHA o para el artefacto inmutable asociado; no autoriza otra versión de la rama.

## 6. Entrega y despliegue continuos (CD)

En este flujo, CD comprende desde `CI_PASSED` hasta que la versión queda desplegada y lista para servir tráfico. Incluye la preparación del despliegue, su ejecución y la publicación técnica de la aplicación.

### 6.1. `DEPLOY_PENDING`

La versión o artefacto aprobado por CI espera recursos o turno para desplegarse. El sistema conserva la relación entre proyecto, SHA, ejecución de CI y artefacto.

### 6.2. `DEPLOYING`

La plataforma crea o actualiza los recursos necesarios para ejecutar la aplicación. Durante esta etapa pueden aparecer errores que el CI no detectó porque dependen del entorno real, por ejemplo incompatibilidades de configuración, fallo al iniciar un contenedor, falta de recursos o indisponibilidad de componentes de infraestructura.

### 6.3. `DEPLOY_FAILED`

Un fallo de despliegue debe clasificarse antes de decidir el siguiente paso:

- **Fallo de infraestructura:** el código o artefacto no necesita cambiar. Se corrige o desaparece la incidencia de plataforma y se reintenta desde `DEPLOY_PENDING` utilizando el mismo SHA y artefacto.
- **Fallo atribuible al proyecto:** la aplicación no puede ejecutarse correctamente por un problema de su código o configuración. El desarrollador debe corregirlo y crear un nuevo commit; el nuevo SHA vuelve a `CI_PENDING` y recorre otra vez CI antes de desplegarse.

El sistema registra la causa y el resultado sin revelar secretos. Un `DEPLOY_FAILED` no debe presentarse como `CI_FAILED`, aunque ambos puedan exigir intervención del desarrollador en casos distintos.

### 6.4. `DEPLOYED`

El despliegue llega a `DEPLOYED` cuando la versión fue creada satisfactoriamente según el criterio operativo que se acuerde. El historial conserva el SHA efectivamente desplegado y lo diferencia de otras candidatas.

## 7. Publicación de la URL

El desarrollador elige la parte propia del subdominio. Debe contener entre 3 y 20 caracteres, sin contar `.<APP_BASE_DOMAIN>`, y solo puede utilizar minúsculas, números y guiones; no puede comenzar ni terminar con guion ni usar nombres reservados.

El hostname completo se reserva de manera atómica. Si ya existe, se informa el conflicto y el desarrollador debe escoger otro; el sistema no asigna una alternativa automáticamente.

El Wrapper crea el recurso de routing y solicita el certificado a través de `cert-manager`, usando el `Issuer` o `ClusterIssuer` configurado. `cert-manager` obtiene y renueva el certificado y mantiene la clave en un Secret TLS de Kubernetes.

La URL solo se considera lista cuando se cumplen conjuntamente:

```text
DNS_OR_PUBLICATION_READY
+ ROUTE_READY
+ TLS_READY
+ SERVICE_ENDPOINTS_READY
```

Hasta entonces, terminar el despliegue no basta para afirmar que la aplicación está públicamente disponible. El tráfico HTTP debe redirigirse a HTTPS.

## 8. Mantenimiento

Un proyecto desplegado entra en mantenimiento y conserva el ciclo de vida `ACTIVE`. Desde esta etapa se realizan las operaciones normales sobre un proyecto admitido.

### 8.1. Nuevas versiones

Un nuevo commit de la rama configurada inicia el recorrido desde `CI_PENDING`, según el disparador que se elija al cerrar la decisión de CI. No necesita otra aprobación administrativa.

La candidata y la versión en servicio son conceptos distintos. Mientras una actualización está pendiente, falla o se vuelve a intentar, el historial debe seguir mostrando cuál fue la última versión desplegada. Mantenerla efectivamente disponible durante todos los fallos es todavía una decisión operativa pendiente.

### 8.2. Configuración editable

El propietario puede cambiar:

- el nombre visible del proyecto;
- la rama utilizada para procesos posteriores.

Cambiar la rama no altera de forma retroactiva solicitudes, commits, ejecuciones ni versiones anteriores. El repositorio no puede cambiarse: usar otro repositorio implica registrar otro proyecto. El efecto de cambiar el nombre sobre el subdominio todavía no está decidido.

### 8.3. Colaboradores

El desarrollador propietario del repositorio y responsable del despliegue puede invitar o retirar colaboradores institucionales. En general, estos deben coincidir con colaboradores del repositorio; queda pendiente concretar la validación cuando un proyecto utiliza varios repositorios.

La transferencia de propiedad también permanece pendiente. Todas las invitaciones, aceptaciones, rechazos, retiros y cambios de acceso deben quedar auditados.

### 8.4. Consulta y seguimiento

El desarrollador puede consultar los estados, la versión en servicio, las candidatas y el historial. Los cambios de estado se comunican al dashboard mediante SSE, pero el estado vigente también puede recuperarse mediante una consulta normal después de una desconexión.

Los administradores disponen de una vista de consulta para proyectos y estado general de la infraestructura. Esta vista no concede por sí sola permisos de modificación del clúster.

## 9. Eliminación iniciada por el desarrollador

### 9.1. Solicitud y confirmación

El desarrollador autorizado solicita voluntariamente la eliminación de su proyecto. Solicitar y confirmar son acciones separadas: antes de ejecutar el proceso, el Wrapper muestra sus consecuencias y exige una confirmación explícita.

Al confirmar:

1. se bloquean trabajos nuevos;
2. se cancelan los trabajos pendientes;
3. se solicita la finalización segura de los trabajos activos;
4. se conceden como máximo 5 minutos para terminar y después se fuerza su cancelación;
5. se impide que un resultado concurrente publique una versión, restablezca tráfico o devuelva el proyecto a `DEPLOYED`;
6. se detiene la aplicación y se retira el tráfico;
7. se eliminan únicamente sus recursos efímeros exclusivos;
8. se inventarían los volúmenes y datos persistentes.

El repositorio de GitHub, las cuentas de usuario y los recursos compartidos del clúster quedan fuera de la eliminación.

La eliminación voluntaria asigna 15 días de retención por defecto. Un administrador puede ampliarlos justificadamente a 30 días según la complejidad del proyecto o el volumen ocupado.

## 10. Solicitud administrativa de eliminación

El administrador no elimina directamente el proyecto. Crea una solicitud administrativa con un motivo obligatorio y elige:

- un plazo inicial de 7, 14 o 21 días, según la complejidad de la migración;
- un periodo posterior de retención de 15 o 30 días, según la complejidad y el volumen del proyecto.

El ciclo de vida pasa a `DELETION_REQUESTED`, pero la aplicación continúa activa durante el plazo. La solicitud no detiene tráfico, no cancela trabajos y no bloquea despliegues por sí sola.

### 10.1. Notificaciones

La solicitud se notifica al crearla y genera los siguientes recordatorios:

| Plazo inicial | Recordatorios antes del vencimiento |
| --- | --- |
| 7 días | 3 y 1 día |
| 14 días | 7, 3 y 1 día |
| 21 días | 14, 7, 3 y 1 día |

### 10.2. Respuesta del desarrollador

Antes del vencimiento, el desarrollador puede:

- solicitar y confirmar la eliminación; en ese caso se ejecuta el mismo proceso iniciado por el desarrollador y se vincula con la solicitud administrativa;
- solicitar una única prórroga justificada.

Un administrador aprueba o rechaza la prórroga. Si la aprueba, elige 7, 14 o 21 días adicionales, contados desde el vencimiento anterior. Se cancelan los recordatorios pendientes y se programan los correspondientes a la nueva fecha.

### 10.3. `SUSPENDED`

Si el plazo vence sin eliminación ni prórroga aprobada, el proyecto pasa a `SUSPENDED`. Entonces se aplica la coordinación de trabajos descrita para la eliminación voluntaria: se bloquean trabajos nuevos, se cancelan los pendientes y los activos reciben hasta 5 minutos antes de su cancelación forzada.

Después se detiene la aplicación, se retira el tráfico, se bloquean nuevos despliegues y se eliminan los recursos efímeros exclusivos. Los datos persistentes no se eliminan todavía: pasan al periodo de retención de 15 o 30 días elegido cuando se creó la solicitud.

La suspensión genera su propia notificación y no equivale a `DELETED`.

## 11. `RETAINED`

Tanto la eliminación confirmada por el desarrollador como la suspensión por vencimiento administrativo convergen en `RETAINED`.

Durante este estado:

- la aplicación permanece detenida y sin tráfico;
- los recursos efímeros exclusivos ya fueron eliminados;
- los datos persistentes se mantienen cifrados, aislados y con acceso restringido;
- se registra la fecha prevista de eliminación definitiva;
- se intenta crear un snapshot si la infraestructura de almacenamiento lo permite.

Si no puede crearse el snapshot, se conserva el volumen original y se informa que la retención no constituye una copia adicional garantizada.

### 11.1. Exportación

El desarrollador responsable puede solicitar una exportación sin aprobación administrativa mientras continúe la retención:

- los volúmenes de archivos se entregan como `.tar.gz`, con manifiesto e información de integridad;
- las bases de datos admitidas se exportan mediante el formato lógico nativo del motor, por ejemplo `.sql`;
- no se incluyen secretos, credenciales ni configuración interna del clúster.

La exportación se genera de forma asíncrona y su estado es consultable. Al terminar, se proporciona un enlace autenticado válido durante 24 horas. Si vence, puede solicitarse otro mientras el proyecto siga en `RETAINED`.

### 11.2. Recuperación

Una solicitud de recuperación presentada antes del final de la retención pausa la eliminación definitiva mientras se decide o ejecuta.

- Si el desarrollador inició voluntariamente la eliminación, puede solicitar la recuperación sin aprobación administrativa.
- Si el proyecto fue suspendido por vencimiento administrativo, el desarrollador debe justificar cómo resolvió la causa y obtener la aprobación de otro administrador.

Recuperar los datos no reactiva inmediatamente la URL. El sistema restaura la información, reconstruye el servicio desde una versión identificada y exige que supere nuevamente el proceso técnico aplicable antes de devolverle tráfico.

### 11.3. Retención administrativa o legal

Un administrador puede crear, renovar o levantar una retención que pause la eliminación definitiva, registrando motivo y fecha de revisión. Cada periodo administrativo dura como máximo 30 días; una retención legal puede no vencer automáticamente, pero requiere revisión periódica.

Estas retenciones se notifican y auditan, pero no reactivan la aplicación.

### 11.4. Fallos durante operaciones de retención

Las exportaciones, snapshots y recuperaciones realizan hasta tres intentos automáticos con espera exponencial. Si se agotan, se informa el fallo y se requiere intervención administrativa.

Un fallo de exportación que no se haya reportado antes del vencimiento no amplía automáticamente el periodo de retención.

## 12. Eliminación definitiva y `DELETED`

Al terminar la retención, el sistema inicia automáticamente la eliminación definitiva, siempre que no exista:

- una recuperación pendiente;
- una exportación en curso;
- una retención administrativa o legal activa.

No se requiere una segunda aprobación manual y nadie puede adelantar la fecha. La autorización procede de la confirmación original del desarrollador o, en la ruta administrativa, de la solicitud, su vencimiento, las notificaciones realizadas y el periodo de retención cumplido.

La operación elimina los datos persistentes y demás recursos exclusivos inventariados de manera idempotente. Si falla parcialmente, el caso permanece abierto y se realizan reintentos controlados; no se declara finalizado hasta comprobar todo el inventario.

Solo después de esa verificación el ciclo de vida pasa a `DELETED`. Este es el estado final y el proyecto ya no puede recuperarse desde el Wrapper.

## 13. Auditoría

El historial debe permitir reconstruir el recorrido sin almacenar secretos ni copiar el contenido completo de los datos. Como mínimo registra:

- registro, responsable, repositorio y rama;
- solicitudes de admisión, propósitos, asignaturas y SHA presentados;
- observaciones, correcciones, decisiones administrativas y autoaprobaciones excepcionales;
- ejecuciones de CI/CD, artefactos o versiones, resultados y causas de fallo;
- cambios de configuración y colaboradores;
- solicitudes de eliminación, motivos, plazos, recordatorios, prórrogas y confirmaciones;
- suspensión, coordinación de trabajos y retirada de tráfico;
- inventario de recursos, retención, snapshots, exportaciones y recuperaciones;
- ejecución de la eliminación definitiva, errores, reintentos y cierre.

La evidencia del caso de eliminación se conserva durante 12 meses desde su cierre. Esta retención de auditoría es independiente de los 15 o 30 días durante los que se conservan los datos persistentes del proyecto.
