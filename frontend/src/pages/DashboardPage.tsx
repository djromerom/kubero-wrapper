import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, type Project } from '../api';
import StatusBadge from '../components/StatusBadge';
import CreateProjectModal from '../components/CreateProjectModal';

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const data = await api.listProjects();
      setProjects(data);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProjects(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">My Projects</h1>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-cyan-600 rounded hover:bg-cyan-500"
        >
          + New Project
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : projects.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg mb-2">No projects yet</p>
          <p>Create your first project to deploy your app</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {projects.map(p => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              className="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 border border-gray-700 hover:border-cyan-700 transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{p.name}</h3>
                  <p className="text-sm text-gray-400 mt-1">{p.repo_url}</p>
                  {p.domain && <p className="text-sm text-cyan-400 mt-1">{p.domain}</p>}
                </div>
                <StatusBadge status={p.status} />
              </div>
            </Link>
          ))}
        </div>
      )}

      <CreateProjectModal open={showModal} onClose={() => setShowModal(false)} onCreated={loadProjects} />
    </div>
  );
}
