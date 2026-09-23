import { Link } from 'react-router-dom';
import { getDemoUser } from '../demoSession';
export default function DeployGuidePage() {
  const demo = Boolean(getDemoUser());
  const steps = demo ? [
    ['Prepara tu repositorio', 'Tu aplicación debe funcionar y tener instrucciones de construcción y ejecución. Identifica el puerto interno del contenedor.'],
    ['Registra la información', 'En Nuevo proyecto, elige un repositorio autorizado de GitHub, una rama y el commit que se revisará. Explica su propósito e indica la asignatura si corresponde.'],
    ['Configura el despliegue', 'Indica el puerto interno y la estrategia de construcción.'],
    ['Confirma y envía a aprobación', 'Revisa los datos y el SHA completo. La solicitud queda en Validación pendiente; enviarla no publica la aplicación.'],
    ['Sigue la validación y el despliegue', 'Si se solicitan correcciones, presenta una versión corregida. Tras la aprobación, el proyecto debe superar CI y el despliegue. La URL estará disponible cuando su publicación y TLS estén listos.'],
  ] : [
    ['Prepara tu proyecto', 'Publica en GitHub la aplicación que quieres registrar.'],
    ['Vincula GitHub', 'Autoriza el repositorio en tu cuenta y selecciona su rama en Nuevo proyecto.'],
    ['Crea el proyecto', 'Revisa la información y confirma el registro. No requiere aprobación administrativa.'],
    ['Consulta el estado', 'Abre el detalle del proyecto para seguir su estado y acceder a la aplicación cuando esté disponible.'],
  ];
  return <article className="max-w-3xl"><Link to="/" className="text-sm text-atlas-red hover:underline">← Mis proyectos</Link><h1 className="mt-5 text-3xl font-semibold">Cómo desplegar</h1><p className="mt-3 text-atlas-muted">De tu repositorio a una aplicación disponible en Atlas.</p><ol className="mt-8 space-y-6">{steps.map(([title, description], index) => <li key={title} className="flex gap-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-atlas-red text-sm text-white">{index + 1}</span><div><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm leading-relaxed text-atlas-muted">{description}</p></div></li>)}</ol></article>;
}
