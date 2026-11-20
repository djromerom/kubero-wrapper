import StatusBadge from './StatusBadge';
const statuses = [
  ['ci_blocked', 'La infraestructura o el acceso al repositorio todavía requieren configuración.'],
  ['ci_queued', 'La solicitud está registrada y espera al procesador de CI.'],
  ['ci_submission_unknown', 'Atlas está conciliando una solicitud; no enviará otra mientras exista incertidumbre.'],
  ['ci_running', 'Woodpecker está construyendo la imagen.'],
  ['ci_verifying', 'Atlas está comprobando el contenido publicado en el Registry.'],
  ['ci_published', 'La imagen y su digest están verificados para ARM64. La aplicación aún no está desplegada.'],
  ['ci_failed', 'La construcción o la verificación de la imagen falló.'],
];
export default function DocumentationPage() {
  return <article className="max-w-4xl space-y-7">
    <h1 className="text-3xl font-semibold">Construir un proyecto en Atlas</h1>
    <ol className="list-decimal space-y-3 pl-5 text-sm">
      <li>Inicia sesión y vincula tu cuenta de GitHub.</li>
      <li>Selecciona un repositorio y una rama a los que tengas acceso. También se admiten organizaciones autorizadas para la GitHub App de Atlas.</li>
      <li>Pulsa «Registrar y construir». Atlas valida el acceso y registra el commit solicitado.</li>
      <li>Consulta el avance de CI en el proyecto. Cuando aparezca «Imagen publicada», podrás ver su referencia y digest.</li>
    </ol>
    <p className="text-sm text-atlas-muted">La configuración central de la plataforma define cómo construir el código. No debes añadir credenciales de infraestructura, certificados ni archivos de pipeline de Woodpecker a tu repositorio. Si todavía no está conectada, el proyecto mostrará CI pendiente de configuración.</p>
    <p className="text-sm text-atlas-muted">En esta fase se construyen imágenes. El despliegue de aplicaciones con Kubero y la compatibilidad de Compose en la configuración central siguen pendientes.</p>
    <table className="w-full text-left text-sm"><caption className="mb-3 text-left font-semibold">Estados de CI</caption><tbody>{statuses.map(([status, text]) => <tr key={status} className="border-b border-atlas-mist"><th scope="row" className="p-3 font-normal"><StatusBadge status={status} /></th><td className="p-3">{text}</td></tr>)}</tbody></table>
    <p className="text-sm">Puedes solicitar una nueva construcción cuando haya terminado la anterior. Archivar un proyecto conserva el historial y las imágenes y no elimina recursos externos.</p>
  </article>;
}
