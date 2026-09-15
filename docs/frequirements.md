# Requisitos funcionales

## Actores y alcance

- **Desarrollador:** estudiante o funcionario con vinculación institucional, incluido personal docente.
- **Administrador:** usuario institucional con permisos adicionales de admisión y supervisión.
- **Sistema:** ejecuta los comportamientos automáticos de las historias; no reemplaza al usuario beneficiario.

La validación administrativa es solo de admisión inicial. Después, las actualizaciones pasan por CI/CD.

## HU-01 — Autenticación institucional

Como usuario institucional, quiero autenticarme mediante el servicio de identidad de la Universidad para acceder al Wrapper con los permisos que me hayan asignado.

### Criterios de aceptación

- **CA-01.1:** La misma entrada sirve a desarrolladores y administradores y delega la autenticación al servicio institucional autorizado.
- **CA-01.2:** El usuario no puede autoasignarse roles. Solo los administradores ven su pestaña adicional.
- **CA-01.3:** Una operación protegida sin identidad o permisos válidos es rechazada por el backend, aunque se invoque directamente.
- **CA-01.4:** La sesión del Wrapper tiene duración limitada y al cerrar sesión se invalida únicamente esta, sin intentar cerrar o modificar la sesión institucional.

### Requisitos funcionales derivados

- **RF-01.1:** El sistema deberá delegar la autenticación en el servicio institucional autorizado sin capturar las credenciales institucionales en formularios propios.
- **RF-01.2:** El sistema deberá asociar la identidad institucional verificada con la cuenta del Wrapper y resolver sus roles desde una fuente confiable.
- **RF-01.3:** El sistema deberá mostrar un dashboard común y habilitar la pestaña administrativa únicamente al rol administrador.
- **RF-01.4:** El sistema deberá verificar en el backend identidad, rol y acceso al recurso en cada operación protegida.
- **RF-01.5:** El sistema deberá crear una sesión propia después de validar la identidad institucional, aplicar los límites configurados de vigencia e inactividad e invalidar su sesión y renovación al cerrar sesión.

## HU-02 — Registrar proyecto

Como desarrollador, quiero registrar un proyecto y enviarlo inmediatamente a admisión institucional para iniciar su revisión en una sola operación.

### Criterios de aceptación

- **CA-02.1:** Se solicita nombre, repositorio y rama; la configuración no se acepta si los datos obligatorios faltan o no puede comprobarse el acceso y la rama.
- **CA-02.2:** El registro conserva al responsable institucional del proyecto.
- **CA-02.3:** Al completar un registro válido, el sistema crea inmediatamente su solicitud de admisión y deja el proyecto pendiente de validación; esto todavía no lo autoriza para desplegarse.

### Requisitos funcionales derivados

- **RF-02.1:** El sistema deberá permitir a un desarrollador autenticado registrar nombre, repositorio, rama y responsable institucional.
- **RF-02.2:** El sistema deberá validar los datos, el acceso autorizado al repositorio y la existencia de la rama antes de aceptar la configuración.
- **RF-02.3:** El sistema deberá persistir el proyecto y crear su primera solicitud de admisión como una única operación válida.
- **RF-02.4:** El sistema deberá asignar `PENDING_VALIDATION` al proyecto registrado y poner su solicitud a disposición de los administradores autorizados.

## HU-03 — Vincular GitHub

Como desarrollador, quiero vincular mi cuenta de GitHub para seleccionar repositorios y ramas accesibles sin escribir sus identificadores manualmente.

### Criterios de aceptación

- **CA-03.1:** La conexión utiliza una GitHub App y no sustituye el acceso institucional.
- **CA-03.2:** El selector muestra repositorios autorizados tanto para el usuario como para la integración; al seleccionar uno se cargan sus ramas.
- **CA-03.3:** Escribir una URL privada no concede acceso; una consulta fallida informa el problema sin presentar una selección como verificada.
- **CA-03.4:** Solo pueden registrarse y desplegarse repositorios seleccionados mediante una cuenta de GitHub vinculada; al desvincularla se conservan los proyectos existentes, pero se bloquean nuevos despliegues hasta volver a vincularla.
- **CA-03.5:** La integración inicial utiliza únicamente lectura de metadatos y contenidos y comprueba acceso concurrente de la GitHub App y del usuario; no obtiene permisos de escritura sin una necesidad posterior aprobada.

### Requisitos funcionales derivados

- **RF-03.1:** El sistema deberá permitir vincular GitHub mediante una GitHub App.
- **RF-03.2:** El sistema deberá consultar y mostrar repositorios y ramas autorizados para el usuario y la integración, sin exponer a todos los usuarios el acceso global de una instalación.
- **RF-03.3:** El sistema deberá comprobar el acceso antes de utilizar una selección e informar errores de consulta o autorización; no tratar una URL manual como credencial.
- **RF-03.4:** El sistema deberá exigir una cuenta de GitHub vinculada y un repositorio autorizado para registrar un proyecto y ejecutar despliegues.
- **RF-03.5:** El sistema deberá bloquear nuevos despliegues cuando se desvincule GitHub, sin eliminar ni suspender automáticamente los proyectos o versiones ya desplegados, y permitirlos nuevamente tras una vinculación válida.
- **RF-03.6:** El sistema deberá solicitar `Metadata: read` y `Contents: read`, usar autorización en nombre del usuario y no solicitar escritura sobre contenidos, administración, deployments, workflows ni webhooks; la integración podrá obtener el repositorio, pero no actuar sobre él.

## HU-04 — Consultar proyectos y su detalle

Como desarrollador, quiero consultar mis proyectos y su detalle para conocer su situación y la versión que está en servicio.

### Criterios de aceptación

- **CA-04.1:** La lista incluye todos los estados, no únicamente los proyectos desplegados.
- **CA-04.2:** El usuario no puede consultar proyectos para los que carezca de autorización.
- **CA-04.3:** El detalle distingue admisión institucional, versión desplegada, candidata en CI/CD e historial; una candidata fallida no se presenta como caída de la versión en servicio.

### Requisitos funcionales derivados

- **RF-04.1:** El sistema deberá listar los proyectos accesibles al usuario indicando su estado.
- **RF-04.2:** El sistema deberá mostrar en el detalle nombre, repositorio, rama, situación de admisión y versión desplegada cuando exista.
- **RF-04.3:** El sistema deberá permitir consultar el historial de solicitudes y ejecuciones asociado al proyecto, manteniendo separadas la versión en servicio y las candidatas.

## HU-05 — Presentar justificación institucional

Como desarrollador, quiero explicar el propósito funcional de mi proyecto y, cuando sea académico, identificar la asignatura correspondiente para que el administrador determine si puede alojarse en la Universidad.

### Criterios de aceptación

- **CA-05.1:** La solicitud exige un propósito en el que la persona explica para qué es funcional el programa.
- **CA-05.2:** Si el proyecto es académico o fue realizado para una materia, la solicitud exige especificar cuál; para proyectos no académicos este campo no aplica.
- **CA-05.3:** El administrador puede consultar la información presentada junto con la solicitud correspondiente.
- **CA-05.4:** El contenido presentado en una solicitud se conserva como evidencia.

### Requisitos funcionales derivados

- **RF-05.1:** El sistema deberá exigir un propósito textual que explique para qué es funcional el programa.
- **RF-05.2:** El sistema deberá permitir indicar si el proyecto es académico y, cuando lo sea, exigir la asignatura correspondiente.
- **RF-05.3:** El sistema deberá asociar la justificación a la solicitud de admisión y hacerla consultable por solicitante y administrador autorizados.
- **RF-05.4:** El sistema deberá conservar la información presentada en cada solicitud sin sobrescribirla al enviar una corrección.

## HU-06 — Solicitar admisión inicial

Como desarrollador, quiero presentar un commit como evidencia para solicitar la admisión de mi proyecto antes del primer despliegue.

### Criterios de aceptación

- **CA-06.1:** Desde el Wrapper se puede abrir el repositorio y seleccionar un commit de la rama configurada; se propone el último disponible al cargar el selector.
- **CA-06.2:** Enviar una solicitud válida la deja pendiente por validación e identifica solicitante, fecha y SHA completo.
- **CA-06.3:** Un push posterior no altera la evidencia enviada. Las actualizaciones de un proyecto ya admitido no exigen otra admisión.

### Requisitos funcionales derivados

- **RF-06.1:** El sistema deberá permitir abrir el repositorio asociado y seleccionar un commit para solicitar la admisión, mostrando su identificador y proponiendo el último disponible de la rama.
- **RF-06.2:** El sistema deberá verificar acceso y correspondencia del commit con repositorio y rama, y registrar proyecto, repositorio, rama, SHA completo, solicitante, fecha y justificación.
- **RF-06.3:** El sistema deberá establecer PENDING_VALIDATION al enviar la solicitud y conservar inmutable la evidencia del commit presentado.
- **RF-06.4:** El sistema deberá limitar esta revisión administrativa a la admisión inicial; no exigirla para cada actualización posterior.

## HU-07 — Consultar observaciones y solicitar revisión

Como desarrollador, quiero consultar las correcciones solicitadas y presentar su resolución para completar la admisión inicial.

### Criterios de aceptación

- **CA-07.1:** Una solicitud de correcciones muestra el texto del administrador.
- **CA-07.2:** El desarrollador corrige fuera del Wrapper y puede enviar otra solicitud seleccionando el commit correspondiente, por defecto el último disponible.
- **CA-07.3:** La nueva solicitud conserva el vínculo con las observaciones previas y no borra el historial; vuelve a pendiente por validación.

### Requisitos funcionales derivados

- **RF-07.1:** El sistema deberá mostrar al desarrollador autorizado las observaciones del administrador y el estado Correcciones pendientes.
- **RF-07.2:** El sistema deberá permitir solicitar revisión durante la admisión inicial, seleccionando el commit y aportando la justificación corregida cuando corresponda.
- **RF-07.3:** El sistema deberá registrar cada nueva solicitud con sus datos y evidencia, relacionarla con el historial y establecer PENDING_VALIDATION sin sobrescribir decisiones anteriores.

## HU-08 — Validar la admisión del proyecto

Como administrador, quiero comprobar la vinculación, finalidad universitaria y funcionalidad del proyecto para decidir si puede desplegarse por primera vez.

### Criterios de aceptación

- **CA-08.1:** La revisión permite consultar justificación, historial y código del commit presentado.
- **CA-08.2:** Se comprueba que el proyecto corresponde a un estudiante o funcionario, fue realizado en una clase o beneficia a la Universidad y cumple una función real.
- **CA-08.3:** El administrador aprueba o solicita correcciones con explicación obligatoria; se registra quién decidió y cuándo.
- **CA-08.4:** Una aprobación admite al proyecto, no obliga a aprobar cada actualización; la revisión administrativa no sustituye las comprobaciones técnicas del CI/CD.
- **CA-08.5:** No existe rechazo definitivo: cuando el proyecto no cumple la rúbrica, el administrador solicita correcciones con explicación y el proyecto puede volver a presentarse sin un límite de intentos.
- **CA-08.6:** Si existe un único administrador activo, puede aprobar su propio proyecto y la excepción queda identificada en auditoría; si existen dos o más, debe decidir otro administrador.

### Requisitos funcionales derivados

- **RF-08.1:** El sistema deberá permitir al administrador consultar las solicitudes, su justificación, historial y código del commit presentado.
- **RF-08.2:** El sistema deberá permitir evaluar vinculación institucional, finalidad universitaria y funcionalidad real; una pantalla decorativa sin utilidad no bastará para la admisión.
- **RF-08.3:** El sistema deberá registrar aprobación o correcciones, administrador, fecha y solicitud evaluada; exigir texto explicativo al solicitar correcciones.
- **RF-08.4:** El sistema deberá registrar la admisión a nivel del proyecto conservando el commit presentado como evidencia, sin exigir revisión humana de cada versión posterior.
- **RF-08.5:** El sistema deberá utilizar únicamente el resultado `APPROVED` o `CORRECTIONS_PENDING` para la admisión, permitir nuevas solicitudes de revisión sin límite funcional de intentos y no establecer un rechazo definitivo.
- **RF-08.6:** Al decidir una solicitud, el sistema deberá contar los administradores activos: permitirá y auditará la autoaprobación únicamente si existe uno; con dos o más impedirá que el solicitante apruebe su proyecto.

## HU-09 — Recibir el primer despliegue automático

Como desarrollador, quiero que la admisión de mi proyecto inicie automáticamente su primer despliegue para no tener que solicitarlo de nuevo.

### Criterios de aceptación

- **CA-09.1:** Un proyecto sin admisión no puede desplegarse.
- **CA-09.2:** La aprobación inicia el proceso sin otro botón del desarrollador y conserva la evidencia del commit objetivo.
- **CA-09.3:** Se distinguen pendiente por despliegue, desplegando, desplegado y despliegue fallido, con resultado consultable.

### Requisitos funcionales derivados

- **RF-09.1:** El sistema deberá impedir desplegar proyectos sin admisión institucional y disparar automáticamente el primer proceso al aprobarlos.
- **RF-09.2:** El sistema deberá registrar Validación aprobada como hito transitorio y el paso por Pendiente por despliegue y Desplegando.
- **RF-09.3:** El sistema deberá utilizar en el primer intento el SHA presentado para la admisión, sin sustituirlo por la punta mutable de la rama.
- **RF-09.4:** El sistema deberá registrar el intento, la versión y el resultado Desplegado o Despliegue fallido.

## HU-10 — Actualizar un proyecto mediante CI/CD

Como desarrollador, quiero actualizar un proyecto admitido mediante CI/CD para publicar versiones sin repetir la validación administrativa.

### Criterios de aceptación

- **CA-10.1:** Las nuevas versiones y correcciones técnicas de un proyecto admitido pasan por CI/CD sin otra aprobación humana.
- **CA-10.2:** Cada ejecución identifica su SHA; si falla CI no se despliega esa versión.
- **CA-10.3:** Un fallo técnico conserva la admisión del proyecto y queda registrado.

### Requisitos funcionales derivados

- **RF-10.1:** El sistema deberá procesar las actualizaciones de proyectos admitidos mediante CI/CD sin repetir su validación administrativa.
- **RF-10.2:** El sistema deberá fijar el SHA objetivo de cada ejecución y mantener la correspondencia entre comprobaciones, construcción y despliegue.
- **RF-10.3:** El sistema deberá impedir el CD de una versión cuando fallen las comprobaciones obligatorias de CI.
- **RF-10.4:** El sistema deberá registrar el resultado de cada ejecución sin revocar automáticamente la admisión por fallos técnicos.

## HU-11 — Consultar resultados de CI/CD y despliegues

Como desarrollador, quiero consultar el resultado de las ejecuciones para identificar qué versión se publicó y dónde falló una actualización.

### Criterios de aceptación

- **CA-11.1:** Se puede consultar el historial por proyecto con versión, etapa y resultado de cada intento.
- **CA-11.2:** Se distingue un CI fallido de un despliegue fallido y de una observación administrativa.
- **CA-11.3:** Los resultados solo están disponibles a usuarios autorizados y la información de diagnóstico no expone secretos.

### Requisitos funcionales derivados

- **RF-11.1:** El sistema deberá mostrar el historial de ejecuciones de CI/CD y despliegue con commit, etapa y resultado.
- **RF-11.2:** El sistema deberá presentar el diagnóstico disponible y distinguir fallos técnicos de las correcciones de admisión institucional.
- **RF-11.3:** El sistema deberá mantener separadas la versión en servicio y las candidatas fallidas y restringir el acceso a sus resultados.

## HU-12 — Supervisión administrativa

Como administrador, quiero consultar el estado de los clústeres y de los proyectos desplegados para supervisar la plataforma.

### Criterios de aceptación

- **CA-12.1:** La pestaña administrativa solo está disponible con el rol correspondiente y sus consultas se protegen en el backend.
- **CA-12.2:** Se muestran disponibilidad del clúster y sus nodos, uso agregado de CPU, memoria y almacenamiento, proyectos por situación, certificados próximos a vencer, trabajos activos o atascados y fecha de la última actualización; ausencia de información no se presenta como estado saludable.
- **CA-12.3:** Esta historia no habilita gestión de usuarios, asignación de roles ni modificaciones de infraestructura.

### Requisitos funcionales derivados

- **RF-12.1:** El sistema deberá mostrar al administrador el estado de clústeres y nodos, uso agregado de CPU, memoria y almacenamiento, proyectos desplegados, suspendidos o fallidos, certificados próximos a vencer, trabajos activos o atascados y fecha de la última actualización.
- **RF-12.2:** El sistema deberá distinguir estado saludable de información no disponible.
- **RF-12.3:** El sistema deberá proteger las consultas administrativas mediante comprobaciones de rol en el backend.

## HU-13 — Consultar todos los proyectos y solicitudes

Como administrador, quiero consultar todos los proyectos y solicitudes de admisión para revisar solicitudes y supervisar el uso de la plataforma.

### Criterios de aceptación

- **CA-13.1:** La vista incluye proyectos admitidos y no admitidos, propietario, estado y solicitud pendiente cuando exista.
- **CA-13.2:** El administrador puede buscar y filtrar la información sin obtener permisos de modificación de infraestructura.
- **CA-13.3:** Solo usuarios con rol administrador pueden consultar esta vista o sus datos mediante el backend.

### Requisitos funcionales derivados

- **RF-13.1:** El sistema deberá listar a los administradores todos los proyectos y solicitudes de admisión con propietario y estado.
- **RF-13.2:** El sistema deberá permitir buscar y filtrar la lista por los atributos soportados.
- **RF-13.3:** El sistema deberá proteger en el backend el listado, sus filtros y el acceso al detalle administrativo.

## HU-14 — Acceder a la aplicación desplegada

Como desarrollador, quiero consultar la URL asignada a mi aplicación para acceder a la versión desplegada.

### Criterios de aceptación

- **CA-14.1:** El desarrollador elige un subdominio de 3 a 20 caracteres —sin contar `.<APP_BASE_DOMAIN>`— formado por minúsculas, números y guiones, sin guion inicial o final y sin utilizar nombres reservados.
- **CA-14.2:** El hostname se reserva de forma atómica. Si ya existe, el sistema informa el conflicto y exige otro nombre sin asignar automáticamente una alternativa.
- **CA-14.3:** El detalle diferencia la URL de servicio del enlace al repositorio.
- **CA-14.4:** Todo acceso público usa HTTPS y las solicitudes HTTP se redirigen a HTTPS.
- **CA-14.5:** La URL solo se presenta como `READY` cuando se cumplen todos los elementos de `URL_READY_CRITERIA`: resolución o publicación del hostname, ruta activa, certificado TLS válido y servicio con endpoints listos.

### Requisitos funcionales derivados

- **RF-14.1:** El sistema deberá validar que el subdominio elegido tenga entre 3 y 20 caracteres, solo minúsculas, números y guiones, sin guion inicial o final ni nombres reservados como `admin`, `api`, `auth`, `www` y `status`; deberá formar, reservar atómicamente y persistir el hostname bajo `APP_BASE_DOMAIN`, rechazándolo si ya existe o está reservado.
- **RF-14.2:** El sistema deberá configurar el recurso de routing definido por `ROUTING_IMPLEMENTATION` para dirigir el hostname al servicio correcto y aislarlo de otros proyectos.
- **RF-14.3:** El sistema deberá mantener asociada la URL con el proyecto y la versión actualmente en servicio.
- **RF-14.4:** El sistema deberá solicitar a `cert-manager`, obtener, almacenar como Secret TLS, asociar y renovar automáticamente un certificado válido mediante el `Issuer` o `ClusterIssuer` configurado, y exponer la aplicación públicamente solo mediante HTTPS.
- **RF-14.5:** El sistema deberá evaluar `URL_READY_CRITERIA`, mantener un estado de preparación consultable y mostrar la URL como disponible únicamente cuando todos sus criterios obligatorios sean satisfactorios.
- **RF-14.6:** El sistema deberá redirigir HTTP a HTTPS, mantener la URL no disponible y mostrar diagnóstico autorizado si falla la emisión del certificado, y alertar a propietario y administradores cuando falle una renovación antes del vencimiento.

## HU-15 — Recibir actualizaciones del proceso

Como desarrollador, quiero recibir actualizaciones del CI/CD y del despliegue para seguir su progreso sin interpretar información obsoleta.

### Criterios de aceptación

- **CA-15.1:** La vista recibe mediante SSE los cambios de estado cuando una ejecución comienza, cambia de etapa, termina o falla.
- **CA-15.2:** Una interrupción del canal de actualización se indica y la interfaz puede recuperar el estado vigente.
- **CA-15.3:** Cada usuario recibe únicamente eventos de proyectos para los que está autorizado.

### Requisitos funcionales derivados

- **RF-15.1:** El sistema deberá comunicar al dashboard mediante Server-Sent Events (SSE) los cambios de estado de CI/CD, despliegue, URL, suspensión y exportación.
- **RF-15.2:** El sistema deberá permitir recuperar el estado vigente después de una desconexión o pérdida de eventos.
- **RF-15.3:** El sistema deberá autorizar la suscripción y filtrar los eventos según el acceso del usuario al proyecto.
- **RF-15.4:** El sistema deberá conservar un estado consultable que no dependa exclusivamente de la recepción en tiempo real.
- **RF-15.5:** El sistema deberá utilizar solicitudes HTTP normales para las acciones del usuario y mantener SSE como canal unidireccional de actualización.

## HU-16 — Procesar cambios del repositorio

Como desarrollador, quiero que los cambios relevantes del repositorio inicien el flujo técnico configurado para mantener actualizado un proyecto admitido.

### Criterios de aceptación

- **CA-16.1:** Solo eventos auténticos de la GitHub App y correspondientes al repositorio y rama configurados se aceptan.
- **CA-16.2:** El procesamiento identifica el SHA del evento y no despliega una versión diferente por cambios posteriores de la rama.
- **CA-16.3:** Los eventos duplicados no generan despliegues duplicados y los eventos inválidos se rechazan y registran.
- **CA-16.4:** Un evento de un proyecto no admitido no inicia su despliegue.

### Requisitos funcionales derivados

- **RF-16.1:** El sistema deberá recibir y verificar los eventos de repositorio requeridos por el disparador de CI/CD elegido.
- **RF-16.2:** El sistema deberá comprobar repositorio, rama, proyecto admitido y SHA antes de crear una ejecución.
- **RF-16.3:** El sistema deberá procesar los eventos de forma idempotente y registrar recepción, aceptación o rechazo.
- **RF-16.4:** El sistema deberá impedir que eventos del repositorio eludan la admisión inicial o los controles obligatorios de CI.

## HU-17 — Exponer el estado operativo del Wrapper

Como operador de la plataforma, quiero consultar el estado operativo del Wrapper para que la infraestructura determine si debe iniciarlo, enviarle tráfico o recuperarlo.

### Criterios de aceptación

- **CA-17.1:** La plataforma puede distinguir que el proceso está vivo, que terminó de iniciar y que está listo para atender tráfico.
- **CA-17.2:** El estado de una dependencia degradada no provoca reinicios inútiles de un proceso que continúa vivo.
- **CA-17.3:** Las respuestas operativas no revelan credenciales ni detalles sensibles y permiten identificar la versión desplegada.

### Requisitos funcionales derivados

- **RF-17.1:** El sistema deberá exponer comprobaciones diferenciadas de liveness, readiness y startup compatibles con la infraestructura de ejecución.
- **RF-17.2:** El sistema deberá considerar las dependencias necesarias para readiness sin convertir automáticamente su indisponibilidad en un fallo de liveness.
- **RF-17.3:** El sistema deberá devolver estados aptos para sondas automáticas e incluir una identificación no sensible de versión.

## HU-18 — Suspender un proyecto por vencimiento del plazo

Como administrador, quiero que un proyecto cuya solicitud de eliminación venció sea suspendido para hacer cumplir la política sin borrar inmediatamente los datos del desarrollador.

### Criterios de aceptación

- **CA-18.1:** Al crear la solicitud, el administrador elige un plazo de 7, 14 o 21 días según la complejidad de la migración; al vencer sin eliminación ni prórroga, el proyecto se suspende, deja de servir tráfico y no acepta nuevos despliegues.
- **CA-18.2:** Al crear la solicitud administrativa, el administrador asigna una retención de 15 o 30 días según la complejidad del proyecto y el volumen ocupado; al suspender se informa al desarrollador y a los administradores la duración y las fechas aplicables.
- **CA-18.3:** La suspensión preserva inicialmente los volúmenes y datos persistentes; no equivale a eliminación.
- **CA-18.4:** Antes del vencimiento, el desarrollador puede solicitar una única prórroga justificada; un administrador la aprueba o rechaza y, si la aprueba, elige 7, 14 o 21 días adicionales contados desde el vencimiento anterior. La decisión y el nuevo plazo quedan notificados y auditados.
- **CA-18.5:** La solicitud se notifica al crearla. Para un plazo de 7 días se recuerda cuando falten 3 y 1 día; para 14 días, cuando falten 7, 3 y 1 día; para 21 días, cuando falten 14, 7, 3 y 1 día. La suspensión produce una notificación propia.
- **CA-18.6:** Antes del vencimiento, la solicitud administrativa no interrumpe el servicio ni cancela trabajos. Al vencer se bloquean trabajos nuevos, se cancelan los pendientes y los activos disponen de hasta 5 minutos para terminar antes de su cancelación forzada.

### Requisitos funcionales derivados

- **RF-18.1:** El sistema deberá suspender un proyecto cuando venza una solicitud administrativa activa sin eliminación ni prórroga registrada.
- **RF-18.2:** El sistema deberá exigir que el administrador elija 15 o 30 días de retención al crear la solicitud administrativa, registrar su elección, deshabilitar tráfico y nuevos despliegues al suspender y mantener separados los recursos persistentes durante el periodo elegido.
- **RF-18.3:** El sistema deberá notificar la suspensión, mostrar su causa y fechas y permitir consultar el estado a las partes autorizadas.
- **RF-18.4:** El sistema deberá permitir elegir únicamente un plazo inicial de 7, 14 o 21 días, notificar la creación y programar los recordatorios correspondientes: `3d, 1d` para 7 días; `7d, 3d, 1d` para 14 días; y `14d, 7d, 3d, 1d` para 21 días.
- **RF-18.5:** El sistema deberá impedir reanudar un proyecto suspendido por esta causa sin una resolución administrativa registrada.
- **RF-18.6:** El sistema deberá permitir al desarrollador solicitar antes del vencimiento una única prórroga justificada y al administrador aprobarla o rechazarla. Si se aprueba, deberá añadir 7, 14 o 21 días al vencimiento anterior, cancelar los recordatorios pendientes, programar los del nuevo vencimiento y conservar solicitud, decisión, actores y fechas en el historial.
- **RF-18.7:** Al vencer la solicitud administrativa, el sistema deberá bloquear trabajos nuevos, cancelar los pendientes, solicitar la terminación de los activos, forzarla después de 5 minutos e impedir que un resultado concurrente restablezca tráfico, publique una versión o devuelva el proyecto a `DEPLOYED`.

## HU-19 — Retirar y eliminar un proyecto

Como desarrollador, quiero eliminar mi proyecto y disponer de un periodo controlado para migrar o recuperar sus datos antes de su eliminación definitiva.

### Criterios de aceptación

- **CA-19.1:** El desarrollador autorizado puede iniciar la eliminación; se muestran consecuencias y se exige confirmación explícita.
- **CA-19.2:** El administrador puede solicitar la eliminación con motivos y fecha límite, pero la solicitud no elimina ni suspende el proyecto antes de vencer.
- **CA-19.3:** Al retirar el servicio se eliminan recursos efímeros exclusivos. Una eliminación iniciada por el desarrollador conserva los datos durante 15 días por defecto; un administrador puede ampliar justificadamente la retención a 30 días. Una solicitud administrativa utiliza los 15 o 30 días elegidos al crearla.
- **CA-19.4:** Durante la retención se informa al desarrollador cómo solicitar la recuperación o exportación. Los volúmenes de archivos se exportan como `.tar.gz` y las bases de datos admitidas mediante el formato lógico nativo del motor; al terminar la retención, el sistema inicia la eliminación definitiva automática si no existe un bloqueo aplicable.
- **CA-19.5:** Nunca se eliminan el repositorio de GitHub, cuentas de usuario ni recursos compartidos del clúster.
- **CA-19.6:** La exportación no incluye secretos, credenciales ni configuración interna del clúster. Los tipos de almacenamiento que la plataforma no pueda exportar se informan antes del despliegue.
- **CA-19.7:** Durante la retención, el desarrollador responsable puede solicitar una exportación sin aprobación administrativa, consultar su generación asíncrona y descargarla desde un enlace autenticado válido durante 24 horas; si vence, puede solicitar otro mientras la retención continúe.
- **CA-19.8:** Durante la retención, el desarrollador puede recuperar sin aprobación un proyecto que eliminó voluntariamente. Para uno suspendido por vencimiento administrativo debe justificar la resolución de la causa y obtener aprobación de otro administrador.
- **CA-19.9:** Una recuperación solicitada antes de terminar la retención pausa la eliminación definitiva mientras se decide o ejecuta; restaurar los datos no restablece el tráfico hasta que una versión identificada supere el proceso técnico aplicable.
- **CA-19.10:** La eliminación definitiva automática no requiere una segunda aprobación y no puede adelantarse. Se bloquea ante recuperación pendiente, exportación en curso o retención administrativa/legal; un fallo parcial mantiene abierto el caso.
- **CA-19.11:** Al comenzar la retención se intenta crear un snapshot cuando el almacenamiento lo soporte. Si no es posible, se conserva el volumen original y se informa claramente que no existe una copia adicional garantizada.
- **CA-19.12:** Al confirmar una eliminación voluntaria se bloquean trabajos nuevos, se cancelan los pendientes y se concede un máximo de 5 minutos a los activos; ningún resultado concurrente puede reactivar el proyecto.
- **CA-19.13:** Solo un administrador puede crear, renovar o levantar una retención que pause la eliminación definitiva. La retención administrativa dura como máximo 30 días por periodo; una retención legal puede no vencer automáticamente, pero requiere revisión periódica. Ninguna reactiva la aplicación.
- **CA-19.14:** Exportaciones, snapshots y recuperaciones realizan hasta tres intentos automáticos con espera exponencial; al agotarlos se informa el fallo y se requiere intervención administrativa. Un fallo de exportación no reportado antes del vencimiento no amplía la retención.

### Requisitos funcionales derivados

- **RF-19.1:** El sistema deberá permitir al desarrollador autorizado confirmar la eliminación de su proyecto.
- **RF-19.2:** El sistema deberá permitir al administrador enviar una solicitud con motivos obligatorios y fecha límite, notificarla dentro del Wrapper y registrar su estado.
- **RF-19.3:** El sistema deberá coordinar trabajos en curso, retirar tráfico y eliminar únicamente recursos efímeros exclusivos al ejecutar la eliminación del servicio.
- **RF-19.4:** El sistema deberá inventariar los volúmenes y datos persistentes afectados; aplicar 15 días de retención por defecto a una eliminación iniciada por el desarrollador, permitir que un administrador la amplíe justificadamente a 30 días, usar el periodo previamente elegido en una solicitud administrativa y conservar los datos cifrados, aislados y con acceso restringido hasta la fecha registrada de eliminación definitiva.
- **RF-19.5:** El sistema deberá permitir registrar y atender la recuperación o exportación durante la retención, entregar volúmenes de archivos como `.tar.gz` con manifiesto e información de integridad y usar la exportación lógica nativa para las bases de datos admitidas, sin convertirlas a CSV.
- **RF-19.6:** El sistema deberá registrar de forma auditable solicitudes, motivos, plazos, entregas de notificación, prórrogas, confirmaciones, suspensiones, inventario de recursos, recuperaciones, eliminaciones definitivas, actores, fechas y resultados, y conservarlos durante 12 meses desde el cierre del caso sin almacenar secretos ni contenidos de los volúmenes.
- **RF-19.7:** El sistema deberá asociar la eliminación realizada por el desarrollador con la solicitud administrativa correspondiente y cerrar su estado.
- **RF-19.8:** El sistema deberá impedir que la eliminación borre repositorios de GitHub, cuentas de usuario o recursos compartidos.
- **RF-19.9:** El sistema deberá excluir secretos, credenciales y configuración interna del clúster de toda exportación e informar antes del despliegue cuando un tipo de almacenamiento no sea exportable por la plataforma.
- **RF-19.10:** El sistema deberá permitir al desarrollador responsable solicitar exportaciones sin aprobación administrativa durante la retención, procesarlas asíncronamente, exponer su estado, entregar el resultado mediante un enlace autenticado válido durante 24 horas, permitir una nueva solicitud si vence y auditar solicitud, generación y descarga.
- **RF-19.11:** El sistema deberá permitir al desarrollador recuperar durante la retención un proyecto eliminado voluntariamente sin aprobación administrativa y exigir justificación y aprobación de otro administrador para recuperar un proyecto suspendido por vencimiento administrativo.
- **RF-19.12:** El sistema deberá pausar la eliminación definitiva cuando exista una solicitud de recuperación presentada dentro del periodo de retención, restaurar los datos y reconstruir el servicio desde una versión identificada, exigir que supere el proceso técnico aplicable antes de restablecer tráfico y auditar cada etapa y resultado.
- **RF-19.13:** Al terminar la retención, el sistema deberá ejecutar automáticamente una eliminación definitiva idempotente sin segunda aprobación manual. Deberá reconocer como autorización la confirmación original del desarrollador o, para una suspensión administrativa, la solicitud, vencimiento, notificaciones y retención cumplida; bloquearla ante recuperación pendiente, exportación en curso o retención administrativa/legal; impedir adelantarla y mantener abierto el caso ante resultados parciales.
- **RF-19.14:** Al comenzar la retención, el sistema deberá crear un snapshot cuando la infraestructura de almacenamiento lo soporte y registrar el resultado. Si no lo soporta o falla, deberá conservar el volumen original e informar al desarrollador y a los administradores que la retención no constituye un respaldo garantizado, sin registrar contenido ni secretos.
- **RF-19.15:** Al confirmar una eliminación voluntaria, el sistema deberá bloquear trabajos nuevos, cancelar los pendientes, solicitar la terminación de los activos, forzarla después de 5 minutos, impedir que resultados concurrentes publiquen o reactiven el proyecto y auditar el resultado de cada trabajo afectado.
- **RF-19.16:** El sistema deberá permitir únicamente a un administrador crear, renovar y levantar una retención administrativa o legal con motivo y fecha de revisión; limitar cada periodo administrativo a 30 días, exigir revisión periódica para la retención legal, notificar y auditar cada cambio y mantener la aplicación inactiva.
- **RF-19.17:** El sistema deberá realizar hasta tres intentos automáticos con espera exponencial para exportaciones, snapshots y recuperaciones; después deberá informar el fallo y requerir intervención administrativa. No deberá extender la retención por un fallo de exportación que no se haya reportado antes del vencimiento, y mantendrá abiertas las eliminaciones definitivas parciales hasta verificar el inventario.

## HU-20 — Editar la configuración de un proyecto

Como desarrollador propietario, quiero cambiar el nombre o la rama de mi proyecto para mantener actualizada su configuración sin registrarlo nuevamente.

### Criterios de aceptación

- **CA-20.1:** El propietario puede cambiar el nombre visible y seleccionar otra rama existente y autorizada del mismo repositorio.
- **CA-20.2:** El repositorio no puede sustituirse: utilizar otro repositorio exige registrar otro proyecto.
- **CA-20.3:** Cambiar la rama no modifica retrospectivamente los commits, solicitudes, ejecuciones ni versiones ya registradas; los procesos posteriores utilizan la nueva rama.
- **CA-20.4:** El efecto de cambiar el nombre sobre el subdominio permanece pendiente y no se asume una modificación automática de la URL.

### Requisitos funcionales derivados

- **RF-20.1:** El sistema deberá permitir al propietario modificar el nombre visible del proyecto y seleccionar una rama existente del repositorio autorizado.
- **RF-20.2:** El sistema deberá validar acceso y existencia de la nueva rama antes de guardar el cambio.
- **RF-20.3:** El sistema deberá impedir cambiar el repositorio asociado e indicar que otro repositorio debe registrarse como un proyecto nuevo.
- **RF-20.4:** El sistema deberá conservar el historial y aplicar la nueva rama únicamente a procesos posteriores al cambio.

## HU-21 — Gestionar colaboradores del proyecto

Como desarrollador propietario del repositorio y responsable del despliegue, quiero invitar colaboradores para compartir con ellos el acceso autorizado al proyecto dentro del Wrapper.

### Criterios de aceptación

- **CA-21.1:** Solo el propietario del proyecto, que debe ser dueño del repositorio seleccionado, puede invitar o retirar colaboradores del Wrapper.
- **CA-21.2:** La invitación identifica a un usuario institucional y concede acceso únicamente después de ser aceptada.
- **CA-21.3:** Como regla general, el colaborador debe corresponder a un colaborador del repositorio; la validación exacta para proyectos compuestos por varios repositorios permanece pendiente.
- **CA-21.4:** Retirar a un colaborador revoca su acceso futuro al proyecto sin borrar sus acciones anteriores del historial.
- **CA-21.5:** Ser colaborador no transfiere la propiedad ni permite cambiar el repositorio o gestionar otros colaboradores.

### Requisitos funcionales derivados

- **RF-21.1:** El sistema deberá permitir únicamente al propietario invitar y retirar usuarios institucionales como colaboradores del proyecto.
- **RF-21.2:** El sistema deberá registrar invitación, aceptación, revocación, actores y fechas, y proteger el acceso al proyecto conforme a la colaboración vigente.
- **RF-21.3:** El sistema deberá comprobar la correspondencia con colaboradores del repositorio cuando sea aplicable y no asumir una regla definitiva para proyectos con varios repositorios hasta cerrar esa decisión.
- **RF-21.4:** El sistema deberá impedir que un colaborador transfiera propiedad, cambie el repositorio o gestione colaboradores, y conservar sus acciones históricas después de retirarlo.
