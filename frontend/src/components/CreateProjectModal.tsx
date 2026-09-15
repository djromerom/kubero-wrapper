import { useEffect, useRef, useState } from 'react';
import { api, type GithubRepository } from '../api';
import { branchesFor, commits, repositories, submitDemoProject, type ProjectDraft } from '../demoProjects';
import { getDemoUser, isDemoGithubLinked, linkDemoGithub } from '../demoSession';

interface Props { open: boolean; onClose: () => void; onCreated: () => void }
const initial: ProjectDraft = { name: '', repo: '', branch: '', commit: '', purpose: '', academic: false, course: '', type: 'Aplicación web', port: 3000, build: 'Detectar automáticamente' };
const field = 'mt-2 w-full rounded-lg border border-atlas-mist bg-atlas-mist px-3 py-2.5 text-sm disabled:opacity-50';

export default function CreateProjectModal({ open, onClose, onCreated }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<ProjectDraft>({ ...initial });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [githubLinked, setGithubLinked] = useState<boolean | null>(null);
  const [githubLogin, setGithubLogin] = useState('');
  const [loadingGithub, setLoadingGithub] = useState(false);
  const [realRepositories, setRealRepositories] = useState<GithubRepository[]>([]);
  const [realBranches, setRealBranches] = useState<string[]>([]);
  const demo = Boolean(getDemoUser());

  const update = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) => setDraft(current => ({ ...current, [key]: value }));

  async function loadRepositories() {
    setLoadingGithub(true);
    setError('');
    try {
      const response = await api.listGithubRepositories();
      setRealRepositories(response.repositories);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoadingGithub(false);
    }
  }

  useEffect(() => {
    if (!open) {
      dialog.current?.close();
      return;
    }
    setStep(1);
    setDraft({ ...initial });
    setError('');
    setSending(false);
    setRealRepositories([]);
    setRealBranches([]);
    dialog.current?.showModal();

    if (getDemoUser()) {
      setGithubLinked(isDemoGithubLinked());
      setGithubLogin(isDemoGithubLinked() ? 'atlas-demo' : '');
      return;
    }

    setGithubLinked(null);
    setLoadingGithub(true);
    api.githubStatus()
      .then(status => {
        setGithubLinked(status.linked);
        setGithubLogin(status.login || '');
        if (status.linked) return loadRepositories();
      })
      .catch(cause => setError((cause as Error).message))
      .finally(() => setLoadingGithub(false));
  }, [open]);

  async function connectGithub() {
    setError('');
    setLoadingGithub(true);
    try {
      if (demo) {
        linkDemoGithub();
        setGithubLinked(true);
        setGithubLogin('atlas-demo');
      } else {
        await api.githubConnect();
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoadingGithub(false);
    }
  }

  async function selectRepository(fullName: string) {
    setError('');
    if (demo) {
      setDraft(current => ({ ...current, repo: fullName, branch: fullName ? 'main' : '', commit: fullName ? commits[0].sha : '' }));
      return;
    }
    setDraft(current => ({ ...current, repo: fullName, branch: '', commit: '' }));
    setRealBranches([]);
    if (!fullName) return;
    const repository = realRepositories.find(item => item.full_name === fullName);
    if (!repository) return;
    const [owner, repo] = repository.full_name.split('/');
    setLoadingGithub(true);
    try {
      const response = await api.listGithubBranches(owner, repo);
      const branchNames = response.branches.map(branch => branch.name);
      const branch = branchNames.find(name => name === 'main') || branchNames[0] || '';
      setRealBranches(branchNames);
      setDraft(current => ({ ...current, branch, commit: '' }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoadingGithub(false);
    }
  }

  function selectBranch(branch: string) {
    setDraft(current => ({ ...current, branch, commit: demo && branch ? commits[0].sha : '' }));
  }

  async function next(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (step === 1 && !draft.purpose.trim()) {
      setError('Explica el propósito funcional del proyecto.');
      return;
    }
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    setSending(true);
    try {
      if (demo) {
        submitDemoProject({ ...draft, purpose: draft.purpose.trim() });
      } else {
        await api.createProject({ name: draft.name, repo_url: `https://github.com/${draft.repo}`, branch: draft.branch });
      }
      onCreated();
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  }

  const availableRepositories = demo
    ? repositories.map(full_name => ({ id: full_name, full_name }))
    : realRepositories.map(repository => ({ id: repository.id, full_name: repository.full_name }));
  const availableBranches = demo ? branchesFor(draft.repo) : realBranches;

  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="create-title" className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-2xl bg-white p-0 text-atlas-ink backdrop:bg-black/50">
    <form onSubmit={next}>
      <header className="px-6 pt-6"><h2 id="create-title" className="text-2xl font-semibold">Nuevo proyecto</h2><p className="mt-2 text-sm text-atlas-muted">Registra tu aplicación y envíala a revisión antes del despliegue.</p></header>
      <ol className="flex gap-3 border-b border-atlas-mist px-6 py-5" aria-label="Pasos de registro">{['Información', 'Despliegue', 'Confirmar'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={`flex flex-1 flex-wrap items-center gap-2 text-xs ${step === index + 1 ? 'font-semibold text-atlas-red' : 'text-atlas-muted'}`}><span className={`grid h-7 w-7 place-items-center rounded-full ${step >= index + 1 ? 'bg-atlas-red text-white' : 'bg-atlas-mist'}`}>{step > index + 1 ? '✓' : index + 1}</span>{label}</li>)}</ol>
      <div className="space-y-4 px-6 py-5">
        {step === 1 && <div className="grid gap-4 md:grid-cols-2">
          {githubLinked !== true ? <section className="rounded-xl border border-atlas-mist bg-atlas-mist/50 p-4" aria-labelledby="github-link-title">
            <h3 id="github-link-title" className="font-semibold">Vincula GitHub para continuar</h3>
            <p className="mt-1 text-xs leading-relaxed text-atlas-muted">Tu cuenta comienza sin vinculación. Autoriza la GitHub App para cargar únicamente los repositorios permitidos.</p>
            <button type="button" onClick={connectGithub} disabled={loadingGithub || githubLinked === null} className="mt-3 rounded-lg bg-atlas-ink px-4 py-2 text-sm text-white disabled:opacity-50">{loadingGithub || githubLinked === null ? 'Comprobando…' : demo ? 'Vincular GitHub (demo)' : 'Vincular GitHub'}</button>
          </section> : <p className="self-start rounded-lg border border-atlas-mist p-3 text-xs text-atlas-muted">GitHub vinculado{githubLogin ? ` · @${githubLogin}` : ''}{demo ? ' · demostración' : ''}</p>}

          <label className="block text-sm">Nombre del proyecto<input autoFocus className={field} value={draft.name} onChange={event => update('name', event.target.value)} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={63} placeholder="recomendador-libros"/><span className="mt-1 block text-xs text-atlas-muted">Solo minúsculas, números y guiones.</span></label>

          {githubLinked === true && <>
            <label className="block text-sm">Repositorio de GitHub<select className={field} required value={draft.repo} disabled={loadingGithub} onChange={event => void selectRepository(event.target.value)}><option value="">Selecciona un repositorio</option>{availableRepositories.map(repository => <option key={repository.id} value={repository.full_name}>{repository.full_name}</option>)}</select></label>
            <label className="block text-sm">Rama<select className={field} required disabled={!draft.repo || loadingGithub} value={draft.branch} onChange={event => selectBranch(event.target.value)}>{!draft.repo ? <option value="">Selecciona primero un repositorio</option> : loadingGithub ? <option value="">Cargando ramas…</option> : !availableBranches.length ? <option value="">No hay ramas disponibles</option> : availableBranches.map(branch => <option key={branch}>{branch}</option>)}</select><span className="mt-1 block text-xs text-atlas-muted">Se utilizará automáticamente el último commit de la rama.</span></label>
          </>}

          <label className="block text-sm md:col-span-2">Propósito funcional<textarea className={field} rows={3} required value={draft.purpose} onChange={event => update('purpose', event.target.value)} placeholder="Explica qué hace la aplicación y para qué se utilizará."/></label>
          <label className="flex items-center justify-between gap-4 text-sm md:col-span-2"><span>¿Pertenece a una clase?<small className="mt-1 block text-atlas-muted">Actívalo si fue realizado para una asignatura.</small></span><input type="checkbox" className="h-5 w-5 accent-atlas-red" checked={draft.academic} onChange={event => setDraft({ ...draft, academic: event.target.checked, course: '' })}/></label>
          {draft.academic && <label className="block text-sm md:col-span-2">Clase / curso asociado<select required className={field} value={draft.course} onChange={event => update('course', event.target.value)}><option value="">Selecciona una asignatura</option>{['Diseño Web II', 'Ingeniería de Software', 'Bases de Datos'].map(course => <option key={course}>{course}</option>)}</select></label>}
        </div>}
        {step === 2 && <>
          <p className="text-sm text-atlas-muted">Define una configuración inicial de despliegue.</p>
          <fieldset><legend className="mb-2 text-sm">Tipo de proyecto</legend><div className="grid gap-3 sm:grid-cols-2">{['Aplicación web', 'API / backend'].map(type => <label key={type} className={`rounded-lg border p-4 text-sm ${draft.type === type ? 'border-atlas-red' : 'border-atlas-mist'}`}><input type="radio" name="project-type" value={type} checked={draft.type === type} onChange={() => update('type', type)} className="mr-2 accent-atlas-red"/>{type}<small className="mt-2 block text-atlas-muted">{type === 'Aplicación web' ? 'Servicio HTTP accesible mediante una URL.' : 'Endpoints para otros clientes.'}</small></label>)}</div></fieldset>
          <label className="block text-sm">Puerto de la aplicación<input type="number" required min={1} max={65535} step={1} className={field} value={draft.port || ''} onChange={event => update('port', Number(event.target.value))}/><span className="mt-1 block text-xs text-atlas-muted">Puerto interno del contenedor, no el puerto público de la URL.</span></label>
          <label className="block text-sm">Configuración de build<select className={field} value={draft.build} onChange={event => update('build', event.target.value)}>{['Detectar automáticamente', 'Dockerfile', 'Configuración personalizada'].map(build => <option key={build}>{build}</option>)}</select></label>
        </>}
        {step === 3 && <><p className="rounded-lg bg-atlas-mist p-3 text-sm">Revisa antes de enviar. El proyecto quedará en <strong>Validación pendiente</strong>. Tras la aprobación comenzará el proceso de build y despliegue.</p><dl className="divide-y divide-atlas-mist text-sm">{Object.entries({ Nombre: draft.name, 'Propósito funcional': draft.purpose, Clase: draft.academic ? draft.course : 'No pertenece a una clase', Responsable: getDemoUser()?.name || 'Usuario actual', Repositorio: draft.repo, Rama: draft.branch, Commit: 'Último de la rama (automático)', Tipo: draft.type, Puerto: draft.port, Build: draft.build }).map(([label, value]) => <div key={label} className="grid gap-1 py-3 sm:grid-cols-[140px_1fr]"><dt className="text-atlas-muted">{label}</dt><dd className="break-all font-medium">{value}</dd></div>)}</dl></>}
        {error && <p role="alert" className="text-sm text-atlas-red">{error}</p>}
      </div>
      <footer className="sticky bottom-0 flex justify-between gap-3 border-t border-atlas-mist bg-white px-6 py-4"><button type="button" onClick={() => { setError(''); if (step === 1) onClose(); else setStep(step - 1); }} className="rounded-lg px-4 py-2 text-sm hover:bg-atlas-mist">{step === 1 ? 'Cancelar' : 'Atrás'}</button><button disabled={sending || githubLinked !== true || loadingGithub} className="rounded-lg bg-atlas-red px-4 py-2 text-sm text-white hover:bg-atlas-ink disabled:opacity-50">{sending ? 'Enviando…' : step === 3 ? 'Enviar a aprobación' : 'Siguiente'}</button></footer>
    </form>
  </dialog>;
}
