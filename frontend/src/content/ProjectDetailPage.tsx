import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Project, type Build, type CiRun } from '../api';
import { useAuth } from '../login/AuthContext';
import CiPanel from './CiPanel';
import DeploymentSettings from './DeploymentSettings';
import BuildsList from './BuildsList';
import ProjectDeletion from './ProjectDeletion';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [builds, setBuilds] = useState<Build[]>([]);
  const [runs, setRuns] = useState<CiRun[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refreshing = useRef(false);
  const load = useCallback(async () => {
    if (!id || refreshing.current) return;
    refreshing.current = true;
    const current = generation.current;
    try {
      const [p, b, c] = await Promise.all([api.getProject(id), api.listBuilds(id), api.listCiRuns(id)]);
      if (generation.current === current) { setProject(p); setBuilds(b); setRuns(c); setError(''); }
    } catch (cause) {
      if (generation.current === current) setError((cause as Error).message);
    } finally {
      if (generation.current === current) { setLoading(false); refreshing.current = false; }
    }
  }, [id]);
  useEffect(() => {
    generation.current += 1; refreshing.current = false; setLoading(true); setProject(null);
    void load();
    const refresh = () => { if (!document.hidden) void load(); };
    const timer = window.setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => { generation.current += 1; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);
  if (loading) return <p>Cargando…</p>;
  if (!project) return <p role="alert">{error || 'Proyecto no disponible.'}</p>;
  return <div className="space-y-5">
    <header><h1 className="text-3xl font-semibold">{project.name}</h1><p className="mt-2 break-all text-sm text-atlas-muted">{project.repo_url} · {project.branch}</p></header>
    {error && <p role="alert" className="text-atlas-red">{error}</p>}
    <p className="text-sm">{project.purpose}</p>
    <CiPanel project={project} runs={runs} onRefresh={load} readOnly={user?.role === 'admin'} />
    <section className="rounded-xl border border-atlas-mist p-5">
      <h2 className="font-semibold">Despliegue · CD</h2>
      <p className="mt-2 text-sm text-atlas-muted">{project.ci_managed ? 'No desplegado. La conexión con Kubero se habilitará en una fase posterior.' : 'Registro histórico conservado. El estado del clúster no se consulta en esta fase.'}</p>
      {!project.ci_managed && <p className="mt-2 text-sm">Último estado guardado: {project.status}{project.domain ? ` · ${project.domain}` : ''}</p>}
    </section>
    {!project.deletion_requested_at && <DeploymentSettings id={project.id} status={project.status} readOnly={user?.role === 'admin'} onSaved={() => void load()} />}
    {builds.length > 0 && <section><h2 className="mb-3 font-semibold">Construcciones anteriores (laboratorio)</h2><BuildsList builds={builds} /></section>}
    <ProjectDeletion project={project} onRequested={setProject} onDeleted={() => navigate(user?.role === 'admin' ? '/admin/projects' : '/')} />
  </div>;
}
