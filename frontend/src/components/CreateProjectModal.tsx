import { useEffect, useState } from 'react';
import { api, type GithubBranch, type GithubRepository } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateProjectModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [repositories, setRepositories] = useState<GithubRepository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GithubRepository | null>(null);
  const [branches, setBranches] = useState<GithubBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [latestCommit, setLatestCommit] = useState<{ sha: string; message: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingGithub, setLoadingGithub] = useState(false);

  const resetModal = () => {
    setName('');
    setRepoUrl('');
    setRepositories([]);
    setSelectedRepo(null);
    setBranches([]);
    setSelectedBranch('');
    setLatestCommit(null);
    setError('');
    setLoadingGithub(false);
  };

  const loadRepositories = async () => {
    setError('');
    setLoadingGithub(true);
    try {
      const data = await api.listGithubRepositories();
      const repoList = data.repositories;
      setRepositories(repoList);
      if (repoList.length > 0) {
        const firstRepo = repoList[0];
        setSelectedRepo(firstRepo);
        setRepoUrl(firstRepo.html_url);
        await loadBranches(firstRepo);
      } else {
        setSelectedRepo(null);
        setRepoUrl('');
        setBranches([]);
        setSelectedBranch('');
        setLatestCommit(null);
      }
    } catch (err) {
      setRepositories([]);
      setSelectedRepo(null);
      setRepoUrl('');
      setBranches([]);
      setSelectedBranch('');
      setLatestCommit(null);
      setError((err as Error).message);
    } finally {
      setLoadingGithub(false);
    }
  };

  const loadBranches = async (repo: GithubRepository) => {
    const [owner, repoName] = repo.full_name.split('/');
    try {
      const data = await api.listGithubBranches(owner, repoName);
      const branchList = data.branches.map((branch) => ({ name: branch.name }));
      setBranches(branchList);
      const mainBranch = branchList.find((branch) => branch.name === 'main')?.name || branchList[0]?.name || '';
      setSelectedBranch(mainBranch);
      await loadLatestCommit(repo, mainBranch);
    } catch (err) {
      setBranches([]);
      setSelectedBranch('');
      setLatestCommit(null);
      setError((err as Error).message);
    }
  };

  const loadLatestCommit = async (repo: GithubRepository, branch: string) => {
    const [owner, repoName] = repo.full_name.split('/');
    try {
      const data = await api.getLatestCommit(owner, repoName, branch);
      setLatestCommit({
        sha: data.commit.sha,
        message: data.commit.commit.message,
      });
    } catch (err) {
      setLatestCommit(null);
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    if (!open) return;
    resetModal();
    loadRepositories();
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.createProject({ name, repo_url: repoUrl, branch: selectedBranch });
      onCreated();
      onClose();
      resetModal();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-lg">
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
            <div className="flex items-center justify-between">
              <label className="block text-sm text-gray-400 mb-1">GitHub Repository</label>
              <button type="button" onClick={api.githubConnect} className="text-xs text-cyan-300 hover:text-cyan-200">
                Connect GitHub
              </button>
            </div>
            {loadingGithub ? (
              <p className="text-sm text-gray-400">Loading authorized repositories...</p>
            ) : (
              <select
                value={selectedRepo?.full_name ?? ''}
                onChange={async (e) => {
                  const found = repositories.find((repo) => repo.full_name === e.target.value);
                  if (!found) return;
                  setSelectedRepo(found);
                  setRepoUrl(found.html_url);
                  await loadBranches(found);
                }}
                className="w-full bg-gray-700 rounded px-3 py-2 text-white"
                required
                disabled={repositories.length === 0}
              >
                <option value="">Select an authorized repository</option>
                {repositories.map((repo) => (
                  <option key={repo.id} value={repo.full_name}>{repo.full_name}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Branch</label>
            <select
              value={selectedBranch}
              onChange={async (e) => {
                const branchName = e.target.value;
                setSelectedBranch(branchName);
                if (selectedRepo) {
                  await loadLatestCommit(selectedRepo, branchName);
                }
              }}
              className="w-full bg-gray-700 rounded px-3 py-2 text-white"
              disabled={branches.length === 0 || !selectedRepo}
              required
            >
              <option value="">Select a branch</option>
              {branches.map((branch) => (
                <option key={branch.name} value={branch.name}>{branch.name}</option>
              ))}
            </select>
          </div>

          {latestCommit && (
            <div className="rounded border border-gray-700 px-3 py-2 text-sm text-gray-300">
              <div className="font-semibold text-cyan-300">Latest commit</div>
              <div className="truncate">{latestCommit.sha.slice(0, 12)}</div>
              <div className="text-gray-400 truncate">{latestCommit.message}</div>
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => { onClose(); resetModal(); }} className="px-4 py-2 text-gray-400 hover:text-white">
              Cancel
            </button>
            <button type="submit" disabled={loading || loadingGithub || !selectedRepo || !selectedBranch} className="px-4 py-2 bg-cyan-600 rounded hover:bg-cyan-500 disabled:opacity-50">
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
