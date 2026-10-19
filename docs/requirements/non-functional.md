# Requisitos no funcionales

## Seguridad

- **RNF-SEC-01:** La identidad deberá basarse en respuestas verificadas del proveedor institucional, no solo en el dominio de un correo. Si se utiliza OIDC, se verificarán firma, emisor, audiencia, vigencia y controles del flujo correspondientes.
- **RNF-SEC-02:** La autorización deberá aplicarse en el servidor y denegar operaciones cuando no pueda demostrarse el permiso. Ocultar componentes de interfaz no constituye protección suficiente.
- **RNF-SEC-03:** La GitHub App deberá aplicar mínimo privilegio: solo lectura de metadatos y contenidos, con permisos efectivos limitados además por la autorización del usuario. La integración podrá obtener repositorios, pero no modificarlos ni actuar sobre ellos.
- **RNF-SEC-04:** Los tokens, claves, credenciales y demás secretos persistidos por el Wrapper deberán almacenarse cifrados o mediante el mecanismo de gestión de secretos de la infraestructura. Su acceso deberá limitarse a los componentes y operaciones que los necesiten.
- **RNF-SEC-05:** Los secretos no deberán incluirse en URLs, respuestas de error, eventos SSE, registros de aplicación ni eventos de auditoría. Cuando un diagnóstico necesite identificar una credencial, deberá utilizar un identificador no sensible o un valor redactado.
- **RNF-SEC-06:** El Wrapper no deberá exponer al navegador tokens de acceso institucionales, tokens de instalación de GitHub ni credenciales de infraestructura. Esta restricción no impide utilizar valores temporales destinados al cliente por el protocolo de autenticación ni cookies de sesión protegidas.
- **RNF-SEC-07:** Toda comunicación que transporte credenciales deberá utilizar un canal cifrado. Las credenciales deberán aplicar mínimo privilegio y, cuando estén vencidas o revocadas, dejar de utilizarse y reemplazarse mediante el flujo de obtención autorizado.
- **RNF-SEC-08:** Los secretos de Kubernetes, credenciales y configuración interna sensible no deberán formar parte de las exportaciones entregadas al desarrollador, de los snapshots exportables ni de los logs.
- **RNF-SES-01:** La sesión del Wrapper deberá estar separada de la sesión institucional, tener vigencia limitada y permitir revocación local sin cerrar ni modificar la sesión institucional u otros servicios universitarios.
- **RNF-SES-02:** La sesión del Wrapper deberá vencer después de 2 horas continuas de inactividad y, aunque exista actividad, tendrá una duración máxima de 7 días desde su creación.
- **RNF-SES-03:** Cerrar sesión deberá invalidar inmediatamente la sesión del Wrapper y cualquier mecanismo de renovación asociado, sin cerrar ni modificar la sesión institucional.
- **RNF-SES-04:** Un cambio o revocación de rol deberá aplicarse en un máximo de 5 minutos. Las operaciones protegidas, especialmente las administrativas, deberán volver a comprobar en el backend que el rol continúa vigente y no depender únicamente del estado mostrado por la interfaz.

## Integridad
- **RNF-INT-01:** La admisión inicial deberá conservar el commit presentado como evidencia. Cada ejecución de CI/CD deberá mantener la correspondencia entre SHA, resultados, construcción y versión desplegada, sin reemplazos por cambios de rama. Esto no exige aprobación administrativa de cada actualización.

## Trazabilidad
- **RNF-TRA-01:** Deberá poder reconstruirse quién solicitó, quién decidió, sobre qué versión y cuál fue el resultado de cada revisión y despliegue. Esta trazabilidad se conservará mientras exista el proyecto y durante 12 meses después de su cierre o eliminación definitiva.
- **RNF-TRA-02:** Los eventos de solicitudes de eliminación, notificaciones, prórrogas, suspensiones, confirmaciones, inventarios, recuperaciones y eliminaciones definitivas deberán ser íntegros, estar restringidos a actores autorizados y conservarse durante 12 meses desde el cierre del caso, independientemente de la retención de los datos del proyecto.
- **RNF-DAT-01:** Los volúmenes y datos persistentes de un proyecto retirado deberán mantenerse cifrados, aislados y con acceso restringido durante 15 días por defecto o 30 días cuando un administrador lo haya seleccionado o ampliado justificadamente; su recuperación, exportación y eliminación definitiva deberán ser verificables. La auditoría no deberá almacenar secretos ni el contenido completo de esos datos.
- **RNF-DAT-02:** Las exportaciones deberán incluir manifiesto e información de integridad, excluir secretos, credenciales y configuración interna del clúster y conservar la semántica de las bases de datos mediante el formato lógico nativo del motor.
- **RNF-DAT-03:** Los enlaces de exportación deberán exigir autenticación, autorizar únicamente al responsable del proyecto y personal autorizado, vencer en 24 horas y no extender la retención de los datos subyacentes.
- **RNF-DAT-04:** La creación de snapshots al comenzar la retención deberá ser verificable y registrar capacidad y resultado sin contenido ni secretos. Cuando no exista soporte o la operación falle, el sistema no deberá presentar la conservación del volumen original como un respaldo garantizado.
- **RNF-RES-01:** Exportaciones, snapshots y recuperaciones deberán realizar hasta tres intentos automáticos con espera exponencial y conservar un resultado verificable; las eliminaciones definitivas parciales permanecerán abiertas hasta comprobar todos los recursos inventariados.
- **RNF-NET-01:** Las aplicaciones expuestas públicamente deberán utilizar HTTPS con certificados válidos obtenidos y renovados automáticamente por `cert-manager`. Las claves deberán almacenarse en Secrets de Kubernetes y un hostname no deberá anunciarse como listo hasta satisfacer `URL_READY_CRITERIA`.

## Disponibilidad

- **RNF-DIS-01:** El Wrapper deberá alcanzar una disponibilidad mensual mínima del 99 %, excluyendo únicamente los mantenimientos programados conforme a RNF-DIS-02.
- **RNF-DIS-02:** Los mantenimientos programados deberán notificarse con al menos 24 horas de anticipación y no superar en conjunto 4 horas por mes. Las intervenciones de emergencia podrán realizarse sin aviso previo, pero deberán registrarse como incidentes y contarán para el cálculo de disponibilidad.
- **RNF-DIS-03:** La indisponibilidad del Wrapper no deberá detener automáticamente las aplicaciones ya desplegadas; estas continuarán funcionando mientras la infraestructura que las ejecuta permanezca saludable. El dashboard, las operaciones de gestión y los nuevos despliegues podrán permanecer temporalmente indisponibles.
- **RNF-DIS-04:** La meta de disponibilidad del Wrapper no constituirá una garantía sobre fallos causados por el código o la configuración propios de una aplicación desplegada.

## Rendimiento y actualización de estado

- **RNF-REN-01:** Bajo la carga definida en RNF-CAP-01, las operaciones síncronas normales del backend deberán completar con una latencia p95 inferior a 500 ms. Las consultas de listas y detalles podrán tener una latencia p95 inferior a 1 segundo. La medición se realizará en el backend y excluirá el tiempo atribuible a proveedores externos.
- **RNF-REN-02:** Los builds, despliegues, exportaciones y demás operaciones largas deberán procesarse asíncronamente. La solicitud inicial deberá aceptarse o rechazarse en menos de 1 segundo bajo la carga definida.
- **RNF-SSE-01:** Al menos el 95 % de los cambios de estado confirmados por el backend deberán comunicarse mediante SSE al cliente conectado en un máximo de 2 segundos.
- **RNF-SSE-02:** Ante una desconexión de SSE, el cliente deberá intentar reconectarse automáticamente y recuperar el estado vigente para corregir eventos perdidos. La consistencia del estado no deberá depender exclusivamente del canal SSE.
- **RNF-SSE-03:** La suscripción y cada evento deberán respetar los permisos vigentes del usuario y no incluir secretos ni información de proyectos no autorizados.

## Capacidad y concurrencia

- **RNF-CAP-01:** El MVP deberá soportar como mínimo 50 usuarios activos simultáneamente, 100 proyectos registrados y 30 aplicaciones desplegadas, siempre que los recursos solicitados por estas últimas no excedan la capacidad disponible del clúster.
- **RNF-CAP-02:** El sistema deberá admitir hasta 10 solicitudes concurrentes de CI/CD; las solicitudes adicionales deberán conservarse en una cola y reflejar un estado consultable, sin omitir los controles obligatorios.
- **RNF-CON-01:** Las operaciones duplicadas o concurrentes sobre un mismo proyecto deberán procesarse de forma idempotente y ordenada: no crearán dos despliegues de la misma versión ni permitirán que una versión antigua sobrescriba una versión posterior.

## Resiliencia ante dependencias externas

- **RNF-RES-02:** Cada intento de comunicación con GitHub, el proveedor institucional o Kubernetes deberá aplicar un tiempo límite máximo de 10 segundos. Solo las operaciones seguras o idempotentes podrán realizar hasta tres intentos automáticos con espera exponencial.
- **RNF-RES-03:** La indisponibilidad de una dependencia externa deberá reflejarse como estado degradado, pendiente o fallido con diagnóstico autorizado. El sistema no deberá omitir autenticación, autorización, CI ni otra comprobación obligatoria para continuar.
- **RNF-RES-04:** La indisponibilidad de GitHub deberá impedir temporalmente los registros y despliegues que necesiten obtener el repositorio, sin detener por sí sola las aplicaciones ya desplegadas.
- **RNF-RES-05:** La indisponibilidad del proveedor institucional deberá impedir nuevas autenticaciones, pero no invalidará por sí sola las sesiones vigentes del Wrapper mientras estas no hayan vencido ni exista una revocación conocida.
- **RNF-RES-06:** Si el clúster no está disponible, el Wrapper deberá conservar la solicitud y presentarla como pendiente o fallida según el punto alcanzado, sin registrar ni anunciar un despliegue satisfactorio.

## Continuidad y recuperación del Wrapper

- **RNF-BCP-01:** La base de datos y la configuración persistente del Wrapper deberán respaldarse de forma cifrada al menos cada 24 horas, con un objetivo de punto de recuperación (`RPO`) de 24 horas. Este requisito no constituye un respaldo general de los datos de las aplicaciones desplegadas.
- **RNF-BCP-02:** El Wrapper deberá tener un objetivo de tiempo de recuperación (`RTO`) máximo de 4 horas después de declarar un incidente recuperable mediante respaldo.
- **RNF-BCP-03:** Las copias de seguridad del Wrapper deberán conservarse durante 30 días con acceso restringido y eliminación controlada al vencer su retención.
- **RNF-BCP-04:** Deberá probarse una restauración al menos una vez cada tres meses. Una copia no deberá considerarse válida hasta comprobar su integridad y posibilidad de restauración, dejando evidencia del resultado.

## Observabilidad y registros

- **RNF-OBS-01:** El Wrapper deberá producir logs estructurados con fecha y hora, nivel, componente, identificador de correlación y, cuando corresponda, identificadores no sensibles del proyecto y la operación.
- **RNF-OBS-02:** Deberán recopilarse métricas de disponibilidad, latencia, errores, conexiones SSE, profundidad y espera de colas, ejecuciones de CI/CD, despliegues y estado de certificados.
- **RNF-OBS-03:** Una condición crítica detectada deberá generar una alerta operativa en un máximo de 5 minutos.
- **RNF-OBS-04:** Los logs operativos deberán conservarse durante 30 días. Esta retención es independiente de los 12 meses establecidos para la auditoría de los casos de eliminación.
- **RNF-OBS-05:** Logs, métricas y alertas no deberán contener tokens, claves, secretos ni el contenido completo de los proyectos. Los componentes deberán mantener sus relojes sincronizados para permitir ordenar y correlacionar eventos.

## Accesibilidad

- **RNF-ACC-01:** La interfaz web del Wrapper deberá cumplir WCAG 2.2 en nivel AA. Este requisito se aplica al Wrapper y no convierte a la plataforma en responsable de la accesibilidad del contenido de las aplicaciones desplegadas.
- **RNF-ACC-02:** Todas las funciones del Wrapper deberán poder utilizarse con teclado, mantener un foco visible y presentar nombres, instrucciones, errores y cambios de estado perceptibles para tecnologías de asistencia.
- **RNF-ACC-03:** La interfaz no deberá comunicar significado únicamente mediante color. Los estados de admisión, CI/CD, suspensión y eliminación deberán acompañarse de texto o indicadores equivalentes.
- **RNF-ACC-04:** La conformidad deberá comprobarse con análisis automatizado y revisión manual de navegación por teclado, foco, formularios, mensajes de estado y contraste antes de publicar una versión del Wrapper.

## Compatibilidad

- **RNF-COM-01:** La interfaz deberá funcionar en la versión estable vigente y la inmediatamente anterior de Chrome, Edge y Firefox, sin depender de extensiones del navegador.
- **RNF-COM-02:** Las funciones esenciales deberán permanecer utilizables desde 360 píxeles de ancho y adaptarse a pantallas mayores sin pérdida de información ni controles inaccesibles.
- **RNF-COM-03:** El backend deberá empaquetarse como imagen de contenedor OCI y ejecutarse sobre una versión de Kubernetes soportada por la infraestructura institucional. La arquitectura de CPU y las versiones concretas deberán declararse en cada entrega y verificarse antes del despliegue; no se presume ARM64 hasta confirmar el hardware objetivo.
- **RNF-COM-04:** Los cambios de esquema y contratos internos deberán mantener compatibilidad durante la actualización necesaria para desplegar o revertir una versión del Wrapper sin corromper datos persistentes.

## Mantenibilidad y entrega del Wrapper

- **RNF-MAN-01:** La configuración dependiente del entorno deberá mantenerse fuera del código y de la imagen de contenedor. Los secretos deberán suministrarse mediante el mecanismo seguro de la infraestructura y nunca incorporarse al repositorio ni a la imagen.
- **RNF-MAN-02:** Los flujos críticos de autenticación, autorización, admisión, cambio de estado y eliminación deberán contar con pruebas automatizadas. Una entrega no deberá publicarse si falla alguna prueba obligatoria.
- **RNF-MAN-03:** Las migraciones de datos deberán estar versionadas, ejecutarse de manera controlada y disponer de una estrategia documentada de reversión o restauración antes de aplicarse en producción.
- **RNF-MAN-04:** Cada entrega del Wrapper deberá identificar de forma trazable su versión y commit, documentar los cambios operativos y permitir volver a la última versión saludable en un máximo de 30 minutos cuando no exista una migración irreversible.
- **RNF-MAN-05:** Las dependencias deberán estar fijadas mediante archivos de bloqueo o mecanismos equivalentes, analizarse para detectar vulnerabilidades conocidas y actualizarse mediante un procedimiento reproducible y revisado.
- **RNF-MAN-06:** La documentación operativa deberá incluir instalación, configuración, respaldo, restauración, actualización, reversión y respuesta básica ante incidentes.
