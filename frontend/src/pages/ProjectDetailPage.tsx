import DemoProjectDetailPage from './DemoProjectDetailPage';
import { getDemoUser } from '../demoSession';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Project, type Build } from '../api';
import StatusBadge from '../components/StatusBadge';

export default function ProjectDetailPage() { return getDemoUser() ? <DemoProjectDetailPage /> : <RealProjectDetailPage />; }
function RealProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [builds, setBuilds] = useState<Build[]>([]);
  const [loading, setLoading] = useState(true);
  const [webhook, setWebhook] = useState<{ webhook_url: string; webhook_secret: string } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, b, w] = await Promise.all([
        api.getProject(id),
        api.listBuilds(id),
        api.getWebhook(id).catch(() => null),
      ]);
      setProject(p);
      setBuilds(b);
      setWebhook(w);
    } catch {
      navigate('/');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    if (!id || !confirm('¿Seguro que quieres eliminar este proyecto?')) return;
    await api.deleteProject(id);
    navigate('/');
  };

  if (loading) return <p className="text-atlas-muted">Cargando...</p>;
  if (!project) return <p className="text-atlas-muted">Proyecto no encontrado</p>;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-sm text-atlas-muted mt-1">{project.repo_url} ({project.branch})</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={project.status} />
          <button onClick={handleDelete} className="text-sm text-atlas-red hover:text-atlas-red">Eliminar</button>
        </div>
      </div>

      {project.domain && (
        <div className="bg-white rounded-lg p-4 mb-6">
          <p className="text-sm text-atlas-muted">Disponible en:</p>
          <a href={`https://${project.domain}`} target="_blank" rel="noreferrer"
             className="text-atlas-red hover:underline">
            {project.domain}
          </a>
        </div>
      )}

      {webhook && (
        <div className="bg-white rounded-lg p-4 mb-6">
          <h3 className="font-semibold mb-2">Configuración del webhook</h3>
          <p className="text-sm text-atlas-muted">URL:</p>
          <code className="block bg-atlas-mist rounded px-3 py-2 mt-1 text-sm break-all">{webhook.webhook_url}</code>
          <p className="text-sm text-atlas-muted mt-3">Secreto:</p>
          <code className="block bg-atlas-mist rounded px-3 py-2 mt-1 text-sm">{webhook.webhook_secret}</code>
        </div>
      )}

      <div className="bg-white rounded-lg p-4">
        <h3 className="font-semibold mb-4">Builds</h3>
        {builds.length === 0 ? (
          <p className="text-atlas-muted text-sm">Todavía no hay ejecuciones. Envía cambios al repositorio para iniciar una.</p>
        ) : (
          <div className="space-y-3">
            {builds.map(b => (
              <div key={b.id} className="bg-atlas-mist rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-atlas-muted">
                    {b.commit_message || b.commit_sha?.slice(0, 7) || 'Desconocido'}
                  </span>
                  <StatusBadge status={b.status} />
                </div>
                {b.logs && (
                  <pre className="text-xs text-atlas-muted mt-2 max-h-32 overflow-y-auto">{b.logs}</pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
