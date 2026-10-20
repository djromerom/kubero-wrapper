import { Link } from 'react-router-dom';
import { useAuth } from '../login/AuthContext';
import StatusBadge from './StatusBadge';

const sections = [
  ['preparacion', 'Antes de empezar'],
  ['solicitud', 'Solicitud y revisión'],
  ['estados', 'Estados del proyecto'],
  ['despliegue', 'Builds, imágenes y logs'],
  ['acceso', 'Acceso a la aplicación'],
  ['eliminacion', 'Eliminar un proyecto'],
  ['alcance', 'Alcance actual'],
];

const steps = [
  {
    title: 'Inicia sesión y vincula GitHub',
    description: 'Entra con las credenciales de tu cuenta de Atlas. Desde el menú de tu perfil, vincula tu cuenta personal de GitHub y autoriza los repositorios que quieras usar.',
  },
  {
    title: 'Registra tu proyecto',
    description: 'Pulsa «Nuevo proyecto», selecciona el repositorio y su rama, y completa el nombre, la descripción, la URL propuesta y la asignatura, si corresponde. Atlas registra el commit de esa rama que se presentará a revisión.',
  },
  {
    title: 'Espera la revisión administrativa',
    description: 'El administrador puede aprobar la solicitud o seleccionar los campos que debes corregir y acompañarlos de observaciones. Esta revisión todavía no construye ni despliega la aplicación.',
  },
  {
    title: 'Corrige los campos solicitados',
    description: 'En el detalle encontrarás las observaciones y los campos habilitados para corregir. Al pulsar «Enviar a validación», la solicitud vuelve a revisión. Si cambias el repositorio o la rama, Atlas consulta su commit actual.',
  },
  {
    title: 'Sigue la construcción y el despliegue',
    description: 'Tras la aprobación, el ejecutor construye el Dockerfile del commit registrado, publica su imagen en el registro local y pide a Kubero desplegarla en K3s. Atlas comprueba que responda antes de marcarla como desplegada.',
  },
];

const statuses = [
  ['pending', 'La solicitud espera revisión del administrador. La aplicación aún no se ha construido.'],
  ['corrections', 'Debes atender las observaciones y reenviar los campos indicados.'],
  ['approved', 'La solicitud ya está aprobada; falta que el ejecutor comience a procesarla.'],
  ['building', 'Se está construyendo la imagen o preparando y verificando su despliegue.'],
  ['running', 'La aplicación respondió correctamente por su URL al finalizar el despliegue.'],
  ['failed', 'Falló la construcción o el despliegue. Revisa los logs para identificar la causa.'],
  ['deleting', 'El proyecto sigue visible mientras se retiran y verifican sus recursos e imágenes.'],
];

export default function DocumentationPage() {
  const { user } = useAuth();

  return (
    <article className="max-w-4xl space-y-10 pb-8">
      <header>
        <Link to={user?.role === 'admin' ? '/admin/projects' : '/'} className="text-sm text-atlas-red hover:underline">← Proyectos</Link>
        <h1 className="mt-5 text-3xl font-semibold">Documentación</h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-atlas-muted">Cómo registrar, desplegar y eliminar una aplicación en la versión actual de Atlas.</p>
        <p className="mt-4 inline-block rounded-full bg-atlas-mist px-3 py-1 text-xs font-medium">Prueba local · Dockerfile · K3s y Kubero</p>
      </header>

      <nav aria-label="Contenido de la documentación" className="rounded-xl border border-atlas-mist p-5">
        <h2 className="font-semibold">En esta guía</h2>
        <ul className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          {sections.map(([id, title]) => (
            <li key={id}><a href={`#${id}`} className="text-atlas-red hover:underline">{title}</a></li>
          ))}
        </ul>
      </nav>

      <section id="preparacion" aria-labelledby="preparacion-title" className="scroll-mt-6">
        <h2 id="preparacion-title" className="text-xl font-semibold">Antes de empezar</h2>
        <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-relaxed text-atlas-muted">
          <li>El repositorio debe pertenecer a tu cuenta personal de GitHub y estar autorizado para Atlas.</li>
          <li>Sube los cambios a la rama que vas a seleccionar. Un commit que solo existe en tu PC todavía no está disponible para Atlas.</li>
          <li>Incluye un <code className="text-atlas-ink">Dockerfile</code> en la raíz que construya e inicie tu aplicación. En esta prueba, el puerto configurado por defecto es <code className="text-atlas-ink">3000</code>; el servidor debe escuchar en <code className="text-atlas-ink">0.0.0.0</code>.</li>
          <li>Usa nombres completos para las imágenes base, como <code className="break-all text-atlas-ink">docker.io/library/node:22-alpine</code>. El constructor no puede pedirte que elijas un registro durante la construcción.</li>
          <li>El sistema de archivos raíz del contenedor es de solo lectura y <code className="text-atlas-ink">/tmp</code> permite archivos temporales. Si usas Nginx, adapta sus rutas de escritura o utiliza una imagen compatible, como <code className="break-all text-atlas-ink">docker.io/nginxinc/nginx-unprivileged:stable-alpine</code>.</li>
        </ul>
      </section>

      <section id="solicitud" aria-labelledby="solicitud-title" className="scroll-mt-6">
        <h2 id="solicitud-title" className="text-xl font-semibold">Solicitud y revisión</h2>
        <ol className="mt-5 space-y-6">
          {steps.map(({ title, description }, index) => (
            <li key={title} className="flex gap-4">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-atlas-red text-sm text-white">{index + 1}</span>
              <div>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-atlas-muted">{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="estados" aria-labelledby="estados-title" className="scroll-mt-6">
        <h2 id="estados-title" className="text-xl font-semibold">Estados del proyecto</h2>
        <p className="mt-3 text-sm leading-relaxed text-atlas-muted">En la barra, «Validación» agrupa las solicitudes pendientes y las correcciones. «Aprobación» significa que la solicitud ya está aprobada y espera al ejecutor. Al seleccionar una etapa, se filtran las tarjetas de proyectos.</p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-atlas-mist">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Estados que puedes encontrar en Atlas y su significado</caption>
            <thead className="bg-atlas-mist">
              <tr><th scope="col" className="px-4 py-3 font-semibold">Estado</th><th scope="col" className="px-4 py-3 font-semibold">Qué significa</th></tr>
            </thead>
            <tbody className="divide-y divide-atlas-mist">
              {statuses.map(([status, description]) => (
                <tr key={status}>
                  <th scope="row" className="px-4 py-4 align-top font-normal"><StatusBadge status={status} /></th>
                  <td className="min-w-48 px-4 py-4 align-top leading-relaxed text-atlas-muted">{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="despliegue" aria-labelledby="despliegue-title" className="scroll-mt-6 space-y-4">
        <h2 id="despliegue-title" className="text-xl font-semibold">Builds, imágenes y logs</h2>
        <p className="text-sm leading-relaxed text-atlas-muted">Un build es un intento de construcción y despliegue. La imagen es el paquete que se obtiene del Dockerfile; Kubero usa ese paquete para ejecutar la aplicación. Una imagen puede haberse construido correctamente y fallar después al arrancar.</p>
        <p className="text-sm leading-relaxed text-atlas-muted">En «Builds», el intento más reciente lleva «(actual)» junto al código del commit. Esa marca identifica el último intento, aunque haya fallado. Solo se puede abrir un log a la vez, y el icono a la derecha del badge copia su contenido.</p>
        <p className="text-sm leading-relaxed text-atlas-muted">Los logs de construcción explican cómo se creó la imagen y qué pasó al desplegarla. Los «Logs de aplicación y servicios» muestran la salida de los contenedores y se actualizan mientras el panel está abierto.</p>
        <p className="text-sm leading-relaxed text-atlas-muted">Si el despliegue falla, corrige la causa indicada en los logs. Cuando necesites cambiar el código o el Dockerfile, haz commit y push. Después pulsa «Reintentar con la versión actual de la rama»: Atlas consulta ese commit y vuelve a procesar el proyecto sin repetir la aprobación administrativa.</p>
        <p className="text-sm leading-relaxed text-atlas-muted">Pueden quedar imágenes de intentos anteriores almacenadas aunque solo se ejecute una versión. Esas imágenes ocupan disco; tenerlas guardadas no equivale a tener varias aplicaciones funcionando.</p>
      </section>

      <section id="acceso" aria-labelledby="acceso-title" className="scroll-mt-6 space-y-4">
        <h2 id="acceso-title" className="text-xl font-semibold">Acceso a la aplicación</h2>
        <p className="text-sm leading-relaxed text-atlas-muted">Cuando el proyecto esté desplegado, abre el enlace de su tarjeta o de su detalle. Durante la revisión, la URL propuesta está reservada, pero todavía no publica una aplicación.</p>
        <p className="text-sm leading-relaxed text-atlas-muted">En este laboratorio, una dirección como <code className="break-all text-atlas-ink">crono.app.127.0.0.1.sslip.io</code> apunta a la computadora desde la que se abre. sslip.io resuelve el nombre a <code className="text-atlas-ink">127.0.0.1</code>, y Traefik dirige la petición al proyecto según el nombre solicitado. Así varios proyectos comparten la misma IP y puerto de entrada.</p>
        <p className="text-sm leading-relaxed text-atlas-muted">Esa dirección permite probar la aplicación en el equipo que ejecuta Atlas; compartirla con otra persona no le da acceso a tu computadora. Los clústeres reales usarán el dominio y la dirección de entrada que se asignen.</p>
      </section>

      <section id="eliminacion" aria-labelledby="eliminacion-title" className="scroll-mt-6 space-y-4">
        <h2 id="eliminacion-title" className="text-xl font-semibold">Eliminar un proyecto</h2>
        <p className="text-sm leading-relaxed text-atlas-muted">Desde el detalle, pulsa «Eliminar» y confirma. Si hay una construcción en curso, espera a que termine. El proyecto permanecerá visible como «Eliminando» mientras el ejecutor realiza la limpieza.</p>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-atlas-muted">
          <li>Retira la aplicación de Kubero y sus recursos exclusivos, servicios y datos persistentes.</li>
          <li>Elimina sus imágenes del registro local y de la caché de K3s, y recoge las capas sin referencias. Los recursos compartidos se conservan.</li>
          <li>Verifica la retirada y solo entonces marca el proyecto como eliminado y deja de mostrarlo en Atlas.</li>
        </ol>
        <p className="text-sm leading-relaxed text-atlas-muted">Si algún paso falla, el proyecto sigue visible con el error y «Reintentar eliminación». Si el ejecutor está detenido, la solicitud espera a que vuelva a estar activo. La eliminación retira los datos alojados en Atlas; conserva tu código y las copias de datos que necesites antes de confirmarla.</p>
        <p className="text-sm leading-relaxed text-atlas-muted">Durante la recolección de imágenes, el registro se detiene temporalmente. Las otras aplicaciones ya desplegadas continúan funcionando.</p>
      </section>

      <section id="alcance" aria-labelledby="alcance-title" className="scroll-mt-6 rounded-xl bg-atlas-mist p-5">
        <h2 id="alcance-title" className="text-xl font-semibold">Alcance actual</h2>
        <p className="mt-3 text-sm leading-relaxed text-atlas-muted">Esta versión utiliza una cuenta local de Atlas, vinculación de GitHub, revisión administrativa, construcción desde Dockerfile y despliegue local con Kubero sobre K3s.</p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-atlas-muted">
          <li>Un push a GitHub todavía no actualiza automáticamente una aplicación desplegada. La actualización de proyectos desplegados queda pendiente.</li>
          <li>Todavía no se ejecutan CI de los proyectos ni empaquetado automático.</li>
          <li>No se transfiere el repositorio a OpenLab ni se implementa su devolución.</li>
          <li>El acceso institucional y el flujo de Retirement, con suspensión y retención de datos, quedan para etapas posteriores. La eliminación actual es directa.</li>
        </ul>
      </section>
    </article>
  );
}
