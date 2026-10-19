import AdaptationReport from './AdaptationReport';
import { fieldClassName, fieldLabelClassName, controlClassName } from '../shared/formStyles';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Project } from '../api';
import ProjectCard from './ProjectCard';
import { useToast } from '../shared/ToastProvider';

export default function AdminPage() {
  const toast = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Project | null>(null);
  const [decision, setDecision] = useState<'approve' | 'corrections' | null>(null);
  const [technical, setTechnical] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const refreshing = useRef(false);
  const load = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      setProjects(await api.adminListProjects());
    } catch {
      setError('No se pudieron cargar los proyectos.');
    } finally {
      refreshing.current = false;
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => {
      if (!document.hidden) void load();
    };
    const interval = window.setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected]);

  const pending = projects.filter((project) => project.status === 'pending');
  const visible = projects.filter(
    (project) =>
      (filter === 'all' || project.status === filter) &&
      `${project.name} ${project.repo_url}`.toLowerCase().includes(query.toLowerCase())
  );
  const repoName = selected?.repo_url.replace(/^https:\/\/github\.com\//, '') || '';

  function close() {
    setTechnical(false);
    setSelected(null);
    setDecision(null);
    setText('');
    setError('');
  }

  async function review(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !decision) return;
    if (decision === 'approve' && text !== repoName) {
      setError('Escribe exactamente el nombre del repositorio.');
      return;
    }
    setSending(true);
    setError('');
    try {
      await api.reviewProject(
        selected.id,
        decision,
        decision === 'corrections' ? text : undefined,
        technical
      );
      toast(
        decision === 'approve'
          ? 'Proyecto aprobado. Despliegue autorizado.'
          : 'Correcciones solicitadas al desarrollador.'
      );
      close();
      void load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  }

  const refreshAfterRetry = () => {
    close();
    void load();
  };

  const cancelDecision = () => {
    setDecision(null);
    setText('');
    setError('');
  };

  const selectProject = (project: Project) => {
    setSelected(project);
    setText('');
    setDecision(null);
    setError('');
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Proyectos</h1>
        <p className="mt-2 text-sm text-atlas-muted">
          Solicitudes pendientes y proyectos registrados en la plataforma.
        </p>
      </header>
      {error && !selected && (
        <p role="alert" className="text-atlas-red">
          {error}
        </p>
      )}
      <section>
        <h2 className="mb-4 text-xl font-semibold">
          Pendientes de revisión <span className="text-atlas-muted">({pending.length})</span>
        </h2>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {pending.map((project) => (
            <button key={project.id} className="rounded-xl border border-atlas-mist p-5 text-left hover:border-atlas-red" onClick={() => selectProject(project)}>
              <h3 className="font-semibold">{project.name}</h3>
              <p className="mt-2 break-all text-xs text-atlas-muted">{project.repo_url}</p>
              <span className="mt-4 block text-sm font-medium text-atlas-red">
                Revisar solicitud →
              </span>
            </button>
          ))}
        </div>
        {!pending.length && (
          <p className="text-sm text-atlas-muted">No hay proyectos pendientes.</p>
        )}
      </section>
      <section>
        <h2 className="mb-4 text-xl font-semibold">Todos los proyectos</h2>
        <label className={`${fieldClassName} max-w-md`}>
          <span className={fieldLabelClassName}>Buscar proyecto</span>
          <input className={controlClassName} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre o repositorio" />
        </label>
        <div className="my-4 flex flex-wrap gap-2">
          {[
            ['all', 'Todos'],
            ['adapting', 'En adaptación'],
            ['pending', 'Validación pendiente'],
            ['corrections', 'Por corregir'],
            ['approved', 'Aprobados'],
            ['ci_pending', 'CI pendiente'],
            ['building', 'CI en ejecución'],
            ['running', 'Desplegados'],
            ['failed', 'Fallidos'],
          ].map(([value, label]) => (
            <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-full px-3 py-2 text-xs ${filter === value ? 'bg-atlas-red text-white' : 'bg-atlas-mist'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
        <p className="mt-4 text-xs text-atlas-muted">
          Mostrando {visible.length} de {projects.length} proyectos
        </p>
      </section>
      <dialog ref={dialog} onCancel={close} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl p-6 backdrop:bg-black/50" aria-labelledby="review-title">
        {selected && (
          <>
            <h2 id="review-title" className="text-xl font-semibold">
              {decision === 'approve'
                ? 'Confirmar aprobación'
                : decision === 'corrections'
                  ? 'Solicitar correcciones'
                  : 'Detalle de la solicitud'}
            </h2>
            <h3 className="mt-4 font-semibold">{selected.name}</h3>
            <dl className="my-4 divide-y divide-atlas-mist text-sm">
              {Object.entries({
                Repositorio: repoName,
                Rama: selected.branch,
                'Commit presentado': selected.source_commit || 'No disponible',
                URL: selected.requested_subdomain
                  ? `${selected.requested_subdomain}.dominio.edu.co`
                  : 'No disponible',
                Asignatura: selected.course || 'No aplica',
                'Propósito funcional': selected.purpose || 'No disponible',
              }).map(([label, value]) => (
                <div key={label} className="py-3">
                  <dt className="text-xs text-atlas-muted">{label}</dt>
                  <dd className="mt-1 break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <AdaptationReport project={selected} onRetry={refreshAfterRetry} />
            {!decision ? (
              <div className="flex flex-wrap justify-end gap-3">
                <button onClick={close}>Cerrar</button>
                <Link to={`/projects/${selected.id}`} className="text-atlas-red">
                  Ver proyecto
                </Link>
                {selected.status === 'pending' && (
                  <>
                    <button onClick={() => setDecision('corrections')} className="rounded-lg border p-2">
                      Solicitar correcciones
                    </button>
                    <button disabled={!selected.adaptation_report?.build_verified} onClick={() => setDecision('approve')} className="rounded-lg bg-atlas-red p-2 text-white">
                      Aprobar
                    </button>
                  </>
                )}
              </div>
            ) : (
              <form onSubmit={(event) => void review(event)}>
                {decision === 'corrections' && (
                  <label className="my-3 flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={technical} onChange={(event) => setTechnical(event.target.checked)} />
                    La corrección afecta la adaptación técnica
                  </label>
                )}
                <label className={fieldClassName}>
                  <span className={fieldLabelClassName}>
                    {decision === 'approve'
                      ? `Escribe exactamente ${repoName}`
                      : 'Explicación obligatoria'}
                  </span>
                  <textarea required value={text} onChange={(event) => setText(event.target.value)} className={controlClassName} rows={decision === 'approve' ? 1 : 4} />
                </label>
                {error && (
                  <p role="alert" className="my-3 text-sm text-atlas-red">
                    {error}
                  </p>
                )}
                <div className="mt-4 flex justify-end gap-3">
                  <button type="button" onClick={cancelDecision}>
                    Atrás
                  </button>
                  <button disabled={sending} className="rounded-lg bg-atlas-red p-3 text-sm text-white disabled:opacity-50">
                    {decision === 'approve' ? 'Aprobar proyecto' : 'Enviar solicitud'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </dialog>
    </div>
  );
}
