import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, type Project } from '../api';
import CreateProjectModal from './CreateProjectModal';
import ProjectCard from './ProjectCard';
import ProjectProgress from './ProjectProgress';
import { projectStages, type ProjectStageId } from './projectStages';
import { IconChevronRight } from '@tabler/icons-react';
import { useToast } from '../shared/ToastProvider';
export default function DashboardPage() {
  const showToast = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  const [selectedStage, setSelectedStage] = useState<ProjectStageId | null>(null);
  const refreshing = useRef(false);
  const loadProjects = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      setProjects(await api.listProjects());
      setError('');
    } catch {
      setError('No se pudieron cargar los proyectos.');
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadProjects();
    const refresh = () => {
      if (!document.hidden) void loadProjects();
    };
    const interval = window.setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadProjects]);
  const corrections = projects.filter((p) => p.status === 'corrections');
  const activeStage = projectStages.find((stage) => stage.id === selectedStage);
  const visibleProjects = projects.filter((project) =>
    activeStage ? activeStage.statuses.includes(project.status) : project.status !== 'corrections'
  );

  function selectStage(stage: ProjectStageId) {
    setSelectedStage((current) => (current === stage ? null : stage));
  }
  const refreshAfterCreation = () => {
    showToast('Proyecto registrado. Comienza el proceso de adaptación.');
    loadProjects();
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Mis proyectos</h1>
          <p className="text-sm text-atlas-muted">
            Gestiona tus aplicaciones y sigue cada despliegue.
          </p>
        </div>
        <div className="flex gap-4 items-center">
          <button onClick={() => setShowModal(true)} className="rounded-lg bg-atlas-red px-4 py-2 text-sm text-white">
            + Nuevo proyecto
          </button>
        </div>
      </header>
      {error && (
        <p role="alert">
          {error}{' '}
          <button onClick={loadProjects} className="text-atlas-red">
            Reintentar
          </button>
        </p>
      )}
      {!!corrections.length && (
        <section>
          <h2 className="mb-3 text-xl font-semibold">Proyectos por corregir</h2>
          <div className="grid gap-3">
            {corrections.map((p) => (
              <Link to={`/projects/${p.id}`} key={p.id} aria-label={`Corregir ${p.name}`} className="flex w-full items-center justify-between gap-5 rounded-xl border border-amber-300 bg-amber-50 p-5">
                <span className="min-w-0">
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="mt-0.5 text-sm text-atlas-muted">{p.review_note}</p>
                </span>
                <IconChevronRight size={20} stroke={2} aria-hidden="true" className="shrink-0 text-atlas-red" />
              </Link>
            ))}
          </div>
        </section>
      )}
      <ProjectProgress projects={projects} loading={loading} selectedStage={selectedStage} onSelectStage={selectStage} />
      {loading ? (
        <p>Cargando…</p>
      ) : (
        <section id="filtered-projects" aria-label={activeStage ? `Proyectos: ${activeStage.label}` : 'Todos los proyectos'} className="space-y-4">
          {activeStage && (
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{activeStage.label}</h2>
              <button type="button" onClick={() => setSelectedStage(null)} className="text-sm text-atlas-red hover:underline">
                Ver todos
              </button>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {visibleProjects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
          {activeStage && !visibleProjects.length && !error && (
            <p className="py-8 text-center text-atlas-muted">
              No hay proyectos en {activeStage.label.toLowerCase()}.
            </p>
          )}
          {!activeStage && !projects.length && !error && (
            <p className="py-12 text-center text-atlas-muted">
              Tu próximo proyecto empieza aquí. Registra tu repositorio.
            </p>
          )}
          <p role="status" className="text-xs text-atlas-muted">
            {activeStage
              ? `${visibleProjects.length} proyectos en ${activeStage.label.toLowerCase()} · ${projects.length} en total`
              : `${projects.length} proyectos en tu espacio de trabajo`}
          </p>
        </section>
      )}
      <CreateProjectModal open={showModal} onClose={() => setShowModal(false)} onCreated={refreshAfterCreation} />
    </div>
  );
}
