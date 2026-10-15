import { Link } from 'react-router-dom';
export default function DocumentationPage() {
  const steps = [
    ['Prepara tu proyecto', 'Publica en GitHub la aplicación que quieres registrar.'],
    [
      'Vincula GitHub',
      'Autoriza el repositorio en tu cuenta y selecciona su rama en Nuevo proyecto.',
    ],
    [
      'Crea el proyecto',
      'Revisa la información y confirma el registro. Atlas inicia la adaptación técnica del repositorio.',
    ],
    [
      'Sigue la revisión',
      'Cuando la adaptación finalice, el proyecto pasa a revisión administrativa. Atiende las correcciones solicitadas antes de su aprobación.',
    ],
    [
      'Consulta el estado',
      'Abre el detalle del proyecto para seguir su estado y acceder a la aplicación cuando esté disponible.',
    ],
  ];
  return (
    <article className="max-w-3xl">
      <Link to="/" className="text-sm text-atlas-red hover:underline">
        ← Mis proyectos
      </Link>
      <h1 className="mt-5 text-3xl font-semibold">Documentación</h1>
      <p className="mt-3 text-atlas-muted">
        De tu repositorio a una aplicación disponible en Atlas.
      </p>
      <h2 className="mt-8 text-xl font-semibold">Cómo desplegar</h2>
      <ol className="mt-5 space-y-6">
        {steps.map(([title, description], index) => (
          <li key={title} className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-atlas-red text-sm text-white">
              {index + 1}
            </span>
            <div>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-atlas-muted">{description}</p>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}
