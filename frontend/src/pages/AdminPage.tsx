import { useState, useEffect } from 'react';
import { api, type Project, type ClusterStatus } from '../api';
import StatusBadge from '../components/StatusBadge';

export default function AdminPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [cluster, setCluster] = useState<ClusterStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        api.adminListProjects(),
        api.clusterStatus().catch(() => null),
      ]);
      setProjects(p);
      setCluster(c);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Admin Panel</h1>

      {cluster && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-sm text-gray-400">Nodes</p>
            <p className="text-2xl font-bold">{cluster.nodes}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-sm text-gray-400">Pods</p>
            <p className="text-2xl font-bold">{cluster.pods}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-sm text-gray-400">Memory</p>
            <p className="text-2xl font-bold">{cluster.memory_usage.toFixed(1)}%</p>
          </div>
        </div>
      )}

      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="font-semibold mb-4">All Projects</h3>
        {loading ? (
          <p className="text-gray-400">Loading...</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-gray-400 text-sm border-b border-gray-700">
                <th className="py-2">Name</th>
                <th className="py-2">Owner</th>
                <th className="py-2">Status</th>
                <th className="py-2">Domain</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(p => (
                <tr key={p.id} className="border-b border-gray-700">
                  <td className="py-3">{p.name}</td>
                  <td className="py-3 text-gray-400">{p.repo_url}</td>
                  <td className="py-3"><StatusBadge status={p.status} /></td>
                  <td className="py-3 text-sm text-gray-400">{p.domain || '-'}</td>
                  <td className="py-3">
                    <button
                      onClick={async () => {
                        if (confirm(`Delete project ${p.name}?`)) {
                          await api.adminDeleteProject(p.id);
                          load();
                        }
                      }}
                      className="text-sm text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
