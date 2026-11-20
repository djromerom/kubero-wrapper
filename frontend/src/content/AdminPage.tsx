import { fieldClassName, fieldLabelClassName, controlClassName } from '../shared/formStyles';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Project } from '../api';
import { projectCiStage } from './projectStages';
import ProjectCard from './ProjectCard';

export default function AdminPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

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
  const visible = projects.filter(
    (project) =>
      (filter === 'all' || projectCiStage(project) === filter) &&
      `${project.name} ${project.repo_url}`.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Proyectos</h1>
        <p className="mt-2 text-sm text-atlas-muted">
          Proyectos registrados y avance de CI.
        </p>
      </header>
      {error && (
        <p role="alert" className="text-atlas-red">
          {error}
        </p>
      )}
      <section>
        <h2 className="mb-4 text-xl font-semibold">Todos los proyectos</h2>
        <label className={`${fieldClassName} max-w-md`}>
          <span className={fieldLabelClassName}>Buscar proyecto</span>
          <input className={controlClassName} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre o repositorio" />
        </label>
        <div className="my-4 flex flex-wrap gap-2">
          {[
            ['all', 'Todos'],
            ['ci_blocked', 'Pendiente de configuración'],
            ['ci_queued', 'CI en cola'],
            ['ci_pending', 'CI en espera'],
            ['ci_submission_unknown', 'Confirmando solicitud'],
            ['ci_running', 'Construyendo'],
            ['ci_verifying', 'Verificando imagen'],
            ['ci_published', 'Imagen publicada'],
            ['ci_failed', 'CI fallido'],
            ['running', 'Despliegues históricos'],
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
    </div>
  );
}
