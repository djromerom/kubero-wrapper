import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Project, type Build } from '../api';
import StatusBadge from '../components/StatusBadge';

export default function ProjectDetailPage() {
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
    if (!id || !confirm('Are you sure you want to delete this project?')) return;
    await api.deleteProject(id);
    navigate('/');
  };

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (!project) return <p className="text-gray-400">Project not found</p>;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-sm text-gray-400 mt-1">{project.repo_url} ({project.branch})</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={project.status} />
          <button onClick={handleDelete} className="text-sm text-red-400 hover:text-red-300">
            Delete
          </button>
        </div>
      </div>

      {project.domain && (
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <p className="text-sm text-gray-400">Deployed at:</p>
          <a href={`https://${project.domain}`} target="_blank" rel="noreferrer"
             className="text-cyan-400 hover:underline">
            {project.domain}
          </a>
        </div>
      )}

      {webhook && (
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <h3 className="font-semibold mb-2">Webhook Configuration</h3>
          <p className="text-sm text-gray-400">URL:</p>
          <code className="block bg-gray-700 rounded px-3 py-2 mt-1 text-sm break-all">{webhook.webhook_url}</code>
          <p className="text-sm text-gray-400 mt-3">Secret:</p>
          <code className="block bg-gray-700 rounded px-3 py-2 mt-1 text-sm">{webhook.webhook_secret}</code>
        </div>
      )}

      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="font-semibold mb-4">Builds</h3>
        {builds.length === 0 ? (
          <p className="text-gray-500 text-sm">No builds yet. Push to your repository to trigger a build.</p>
        ) : (
          <div className="space-y-3">
            {builds.map(b => (
              <div key={b.id} className="bg-gray-700 rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-300">
                    {b.commit_message || b.commit_sha?.slice(0, 7) || 'Unknown'}
                  </span>
                  <StatusBadge status={b.status} />
                </div>
                {b.logs && (
                  <pre className="text-xs text-gray-400 mt-2 max-h-32 overflow-y-auto">{b.logs}</pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
