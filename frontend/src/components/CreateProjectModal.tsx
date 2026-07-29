import { useState } from 'react';
import { api } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateProjectModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.createProject({ name, repo_url: repoUrl, branch });
      onCreated();
      onClose();
      setName('');
      setRepoUrl('');
      setBranch('main');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">New Project</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Project Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-gray-700 rounded px-3 py-2 text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Git Repo URL</label>
            <input
              value={repoUrl}
              onChange={e => setRepoUrl(e.target.value)}
              className="w-full bg-gray-700 rounded px-3 py-2 text-white"
              placeholder="https://github.com/user/repo"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Branch</label>
            <input
              value={branch}
              onChange={e => setBranch(e.target.value)}
              className="w-full bg-gray-700 rounded px-3 py-2 text-white"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-cyan-600 rounded hover:bg-cyan-500 disabled:opacity-50">
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
