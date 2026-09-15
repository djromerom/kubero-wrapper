import { Link } from 'react-router-dom';
export default function DeployGuidePage() {
  return <article className="max-w-3xl"><Link to="/" className="text-sm text-atlas-red hover:underline">← Mis proyectos</Link><h1 className="mt-5 text-3xl font-semibold">Cómo desplegar</h1><p className="mt-3 text-atlas-muted">De tu repositorio a una aplicación disponible en Atlas.</p><ol className="mt-8 space-y-6">{[
    ['Prepara tu repositorio', 'Tu aplicación debe funcionar y tener instrucciones de construcción y ejecución. Identifica el puerto interno del contenedor.'],
    ['Registra la información', 'En Nuevo proyecto, elige un repositorio autorizado de GitHub, una rama y el commit que se revisará. Explica su propósito e indica la asignatura si corresponde.'],
    ['Configura el despliegue', 'Selecciona aplicación web o API / backend, el puerto interno y la estrategia de build.'],
    ['Confirma y envía a aprobación', 'Revisa los datos y el SHA completo. La solicitud queda en Validación pendiente; enviarla no publica la aplicación.'],
    ['Sigue la validación y el despliegue', 'Si se solicitan correcciones, presenta una versión corregida. Tras la aprobación, el proyecto debe superar CI y el despliegue. La URL estará disponible cuando su publicación y TLS estén listos.'],
  ].map(([title, text], index) => <li key={title} className="flex gap-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-atlas-red text-sm text-white">{index + 1}</span><div><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm leading-relaxed text-atlas-muted">{text}</p></div></li>)}</ol><p className="mt-8 rounded-xl bg-atlas-mist p-4 text-sm">En esta demostración los repositorios y commits son ejemplos. Las solicitudes se conservan en esta pestaña; no se ejecutan builds ni despliegues reales.</p></article>;
}
