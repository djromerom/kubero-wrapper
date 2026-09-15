# Backlog de la segunda versión

## Desarrollador

| Función | Alcance | Por definir |
| --- | --- | --- |
| Reconstrucción manual | Repetir la construcción sin un nuevo push y sin omitir admisión ni CI | Permisos, reutilización del SHA, diferencia entre reintento, reconstrucción y redespliegue, límites e idempotencia |
| Consulta de logs | Consultar logs de aplicaciones desplegadas | Fuentes, filtros, descarga, actualización, acceso por versión, redacción y retención |
| Pausa y reanudación | Detener temporalmente una aplicación sin eliminarla ni retirar su admisión | Recursos, tráfico, trabajos, persistencia, tiempo de reanudación, permisos y estado; no equivale a `SUSPENDED` |
| Variables de entorno | Configurar valores por proyecto sin modificar código | Separación de secretos, cifrado, enmascaramiento, ambientes, permisos y necesidad de redespliegue |

## Administrador

| Función | Alcance | Por definir |
| --- | --- | --- |
| Límites de recursos | Limitar CPU, memoria y almacenamiento por usuario o proyecto | Valores, alcance, proyectos existentes e integración con Kubernetes |
| Cuotas | Limitar cantidades como proyectos por usuario | Tipos, excepciones, proyectos pausados o eliminados y reducción por debajo del uso actual |
| Consulta de auditoría | Buscar y consultar eventos de auditoría | Campos, filtros, exportación, inmutabilidad y permisos |

## Sistema

| Función | Alcance | Por definir |
| --- | --- | --- |
| Limpieza de builds | Eliminar artefactos y recursos temporales de builds fallidos antiguos | Antigüedad, programación, recursos, auditoría y protección de evidencia y versiones en servicio |
| Limitación de frecuencia | Limitar operaciones costosas por usuario o proyecto | Operaciones, ventana, umbrales, respuesta del API, excepciones, colas y reintentos |
