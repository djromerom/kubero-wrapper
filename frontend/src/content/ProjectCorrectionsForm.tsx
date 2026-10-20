import { useEffect, useState } from 'react';
import { api, type CorrectionField, type GithubRepository, type Project, type ProjectCorrections } from '../api';
import { controlClassName, fieldClassName, fieldLabelClassName } from '../shared/formStyles';
import CustomSelect from './CustomSelect';
import { courseOptions } from './correctionFields';

export default function ProjectCorrectionsForm({ project, onSubmitted }: { project: Project; onSubmitted: (project: Project) => void }) {
  const fields = project.correction_fields || [];
  const repositoryRequested = fields.includes('repo_url');
  const branchRequested = repositoryRequested || fields.includes('branch');
  const [draft, setDraft] = useState<Record<CorrectionField, string>>({
    name: project.name,
    repo_url: project.repo_url,
    branch: project.branch,
    purpose: project.purpose || '',
    requested_subdomain: project.requested_subdomain || '',
    course: project.course || '',
  });
  const [repositories, setRepositories] = useState<GithubRepository[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingRepositories, setLoadingRepositories] = useState(repositoryRequested);
  const [loadingBranches, setLoadingBranches] = useState(branchRequested);
  const [repositoryError, setRepositoryError] = useState('');
  const [branchError, setBranchError] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!repositoryRequested) return;
    let active = true;
    api.listGithubRepositories()
      .then((response) => { if (active) setRepositories(response.repositories); })
      .catch((cause) => { if (active) setRepositoryError((cause as Error).message); })
      .finally(() => { if (active) setLoadingRepositories(false); });
    return () => { active = false; };
  }, [repositoryRequested]);

  useEffect(() => {
    if (!branchRequested) return;
    let active = true;
    const repositoryUrl = draft.repo_url;
    const [owner, repository] = repositoryUrl.replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '').replace(/\.git$/, '').split('/');
    setBranches([]);
    setBranchError('');
    setLoadingBranches(true);
    api.listGithubBranches(owner, repository)
      .then((response) => {
        if (!active) return;
        const names = response.branches.map((branch) => branch.name);
        setBranches(names);
        setDraft((current) => ({
          ...current,
          branch: names.includes(current.branch) ? current.branch : names.find((name) => name === 'main') || names[0] || '',
        }));
      })
      .catch((cause) => { if (active) setBranchError((cause as Error).message); })
      .finally(() => { if (active) setLoadingBranches(false); });
    return () => { active = false; };
  }, [draft.repo_url, branchRequested]);

  function update(field: CorrectionField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || loadingRepositories || loadingBranches) return;
    setError('');
    if (fields.includes('name') && !/^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u.test(draft.name.trim())) {
      setError('El nombre debe usar letras, números, espacios o guiones; comienza y termina con letra o número.');
      return;
    }
    if (repositoryRequested && !repositories.some((repository) => `https://github.com/${repository.full_name}` === draft.repo_url)) {
      setError('Selecciona un repositorio de tu cuenta de GitHub.');
      return;
    }
    if (branchRequested && !branches.includes(draft.branch)) {
      setError('Selecciona una rama disponible del repositorio.');
      return;
    }
    const changes: ProjectCorrections = {};
    for (const field of fields) changes[field] = draft[field].trim();
    if (repositoryRequested) changes.branch = draft.branch;
    setSending(true);
    try {
      onSubmitted(await api.resubmitProject(project.id, changes));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="mt-4 space-y-5" onSubmit={submit}>
      <fieldset disabled={sending} className="space-y-5 disabled:opacity-70">
        <legend className="mb-3 text-sm text-atlas-muted">Actualiza los campos indicados por el administrador.</legend>
        {fields.includes('name') && (
          <label className={fieldClassName}>
            <span className={fieldLabelClassName}>Nombre</span>
            <input required minLength={3} maxLength={50} className={controlClassName} value={draft.name} onChange={(event) => update('name', event.target.value)} />
          </label>
        )}
        {repositoryRequested && (
          <CustomSelect label="Repositorio" value={draft.repo_url} disabled={loadingRepositories} options={[{ value: '', label: loadingRepositories ? 'Cargando repositorios…' : 'Selecciona un repositorio' }, ...repositories.map((repository) => ({ value: `https://github.com/${repository.full_name}`, label: repository.full_name }))]} onChange={(repo) => setDraft((current) => ({ ...current, repo_url: repo, branch: '' }))} />
        )}
        {branchRequested && (
          <CustomSelect label="Rama" value={draft.branch} disabled={loadingBranches || !draft.repo_url} options={[{ value: '', label: loadingBranches ? 'Cargando ramas…' : 'Selecciona una rama' }, ...branches.map((branch) => ({ value: branch, label: branch }))]} onChange={(branch) => update('branch', branch)} />
        )}
        {fields.includes('purpose') && (
          <label className={fieldClassName}>
            <span className={fieldLabelClassName}>Descripción</span>
            <textarea required rows={4} className={controlClassName} value={draft.purpose} onChange={(event) => update('purpose', event.target.value)} />
          </label>
        )}
        {fields.includes('requested_subdomain') && (
          <label className={fieldClassName}>
            <span className={fieldLabelClassName}>URL</span>
            <input maxLength={49} pattern="[a-z0-9](?:[a-z0-9\-]{1,47}[a-z0-9])" className={controlClassName} value={draft.requested_subdomain} onChange={(event) => update('requested_subdomain', event.target.value.toLowerCase())} />
            <span className="text-xs text-atlas-muted">{draft.requested_subdomain ? `${draft.requested_subdomain}.dominio.edu.co` : 'Si lo dejas vacío, Atlas asignará una URL automáticamente.'}</span>
          </label>
        )}
        {fields.includes('course') && (
          <CustomSelect label="Curso" value={draft.course} options={courseOptions} onChange={(course) => update('course', course)} />
        )}
      </fieldset>
      {(error || repositoryError || branchError) && (
        <p role="alert" className="text-sm text-atlas-red">{error || repositoryError || branchError}</p>
      )}
      {!fields.length && <p role="alert" className="text-sm text-atlas-red">Esta solicitud no tiene campos de corrección definidos.</p>}
      <button disabled={sending || loadingRepositories || loadingBranches || !fields.length || Boolean(repositoryError || branchError)} className="rounded-lg bg-atlas-red px-4 py-2 text-sm text-white disabled:opacity-50">
        {sending ? 'Enviando…' : 'Enviar a validación'}
      </button>
    </form>
  );
}
