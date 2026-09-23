import { useEffect, useRef, useState } from 'react';
import { api, type GithubRepository } from '../api';
import { branchesFor, commits, repositories, submitDemoProject, type ProjectDraft } from '../demoProjects';
import { getDemoUser, isDemoGithubLinked, linkDemoGithub, unlinkDemoGithub } from '../demoSession';
import GithubButton from './GithubButton';
import CustomSelect from './CustomSelect';
import { IconChevronRight } from '@tabler/icons-react';
import { useAuth } from '../AuthContext';

interface Props { open: boolean; onClose: () => void; onCreated: () => void }
const initial: ProjectDraft = { name: '', repo: '', branch: '', commit: '', purpose: '', academic: false, course: '', port: 3000, build: 'Detectar automáticamente' };
const courseOptions = [
  { value: '', label: 'No pertenece a ninguna clase' },
  ...['Diseño Web II', 'Ingeniería de Software', 'Bases de Datos'].map(course => ({ value: course, label: course })),
];

export default function CreateProjectModal({ open, onClose, onCreated }: Props) {
  const { user } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<ProjectDraft>({ ...initial });
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [sending, setSending] = useState(false);
  const [githubLinked, setGithubLinked] = useState<boolean | null>(null);
  const [githubLogin, setGithubLogin] = useState('');
  const [loadingGithub, setLoadingGithub] = useState(false);
  const [realRepositories, setRealRepositories] = useState<GithubRepository[]>([]);
  const [realBranches, setRealBranches] = useState<string[]>([]);
  const demo = Boolean(getDemoUser());

  useEffect(() => {
    if (confirmClose) continueButton.current?.focus();
  }, [confirmClose]);

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
    setConfirmClose(false);
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

  async function disconnectGithub() {
    if (!window.confirm('¿Quieres desvincular tu cuenta de GitHub de Atlas?')) return;
    setError('');
    setLoadingGithub(true);
    try {
      if (demo) unlinkDemoGithub();
      else await api.githubDisconnect();
      setGithubLinked(false);
      setGithubLogin('');
      setRealRepositories([]);
      setRealBranches([]);
      setDraft(current => ({ ...current, repo: '', branch: '', commit: '' }));
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

  function requestClose() {
    if (sending) return;
    if (JSON.stringify(draft) !== JSON.stringify(initial)) setConfirmClose(true);
    else onClose();
  }

  async function next(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const projectName = draft.name.trim();
    if (step === 1 && (projectName.length < 3 || projectName.length > 50 || !/^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u.test(projectName))) {
      setError('El nombre debe tener entre 3 y 50 caracteres. Usa letras, números, espacios o guiones; comienza y termina con una letra o un número.');
      return;
    }
    if (step === 1 && (!draft.repo || !draft.branch)) {
      setError('Selecciona un repositorio y una rama.');
      return;
    }
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
        submitDemoProject({ ...draft, name: projectName, purpose: draft.purpose.trim() });
      } else {
        await api.createProject({ name: projectName, repo_url: `https://github.com/${draft.repo}`, branch: draft.branch });
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

  return <dialog
    ref={dialog}
    onCancel={event => { event.preventDefault(); if (confirmClose) setConfirmClose(false); else requestClose(); }}
    onClick={event => {
      if (event.target !== dialog.current || confirmClose) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose();
    }}
    aria-labelledby="create-title"
    className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl bg-white p-0 text-atlas-ink backdrop:bg-black/50"
  >
    <form onSubmit={next} inert={confirmClose}>
      <header className="px-6 pt-6"><h2 id="create-title" className="text-2xl font-semibold">Nuevo proyecto</h2><p className="text-sm text-atlas-muted">{demo ? 'Registra tu aplicación y envíala a revisión antes del despliegue.' : 'Registra tu repositorio y consulta el estado de su despliegue.'}</p></header>
      <ol className="project-steps border-b border-atlas-mist px-6 py-5" aria-label="Pasos de registro">{['Información', 'Despliegue', 'Confirmar'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={`project-step ${step > index + 1 ? 'is-complete' : step === index + 1 ? 'is-active' : ''}`}><span>{index + 1}</span><span>{label}</span></li>)}</ol>
      <div className="space-y-4 px-6 py-5">
        {step === 1 && <div className="grid gap-5">
          <GithubButton linked={githubLinked === true} login={githubLogin} disabled={loadingGithub || githubLinked === null} onClick={githubLinked ? disconnectGithub : connectGithub} />

          <label className="atlas-field"><span className="atlas-field-label">Nombre</span><input autoFocus className="atlas-control" value={draft.name} onChange={event => update('name', event.target.value)} required minLength={3} maxLength={50} placeholder="Mi portafolio"/></label>

          {githubLinked === true && <>
            <CustomSelect label="Repositorio" value={draft.repo} disabled={loadingGithub} onChange={value => void selectRepository(value)} options={[{ value: '', label: 'Selecciona un repositorio' }, ...availableRepositories.map(repository => ({ value: repository.full_name, label: repository.full_name }))]} />
            <CustomSelect label="Rama" value={draft.branch} disabled={!draft.repo || loadingGithub} onChange={selectBranch} options={!draft.repo ? [{ value: '', label: 'Selecciona primero un repositorio' }] : loadingGithub ? [{ value: '', label: 'Cargando ramas…' }] : !availableBranches.length ? [{ value: '', label: 'No hay ramas disponibles' }] : availableBranches.map(branch => ({ value: branch, label: branch }))} />
          </>}

          <label className="atlas-field"><span className="atlas-field-label">Descripción</span><textarea className="atlas-control" rows={2} required value={draft.purpose} onChange={event => update('purpose', event.target.value)} placeholder="Explica qué hace la aplicación y para qué se utilizará"/></label>
          <CustomSelect label="Curso" value={draft.course} options={courseOptions} onChange={value => setDraft(current => ({ ...current, course: value, academic: value !== '' }))} />
        </div>}
        {step === 2 && <>
          <p className="text-sm text-atlas-muted">Define una configuración inicial de despliegue.</p>
          <label className="atlas-field"><span className="atlas-field-label">Puerto de la aplicación</span><input type="number" required min={1} max={65535} step={1} className="atlas-control" value={draft.port || ''} onChange={event => update('port', Number(event.target.value))}/><span className="atlas-field-helper">Puerto interno del contenedor, no el puerto público de la URL.</span></label>
          <CustomSelect label="Configuración de build" value={draft.build} onChange={value => update('build', value)} options={['Detectar automáticamente', 'Dockerfile', 'Configuración personalizada'].map(build => ({ value: build, label: build }))} />
        </>}
        {step === 3 && (
          <dl className="divide-y divide-atlas-mist text-sm">
            {Object.entries({
              Nombre: draft.name,
              Descripción: draft.purpose,
              Repositorio: draft.repo,
              Rama: draft.branch,
              Curso: draft.academic ? draft.course : 'No pertenece',
              Responsable: user?.name || 'Sin nombre',
              Despliegue: `Puerto ${draft.port} - Build en ${draft.build}`,
            }).map(([label, value]) => (
              <div key={label} className="grid gap-1 py-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                <dt className="text-xs text-atlas-muted">{label}</dt>
                <dd className="min-w-0 break-words font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {error && <p role="alert" className="text-sm text-atlas-red">{error}</p>}
      </div>
      <footer className="flex items-center justify-end gap-3 border-t border-atlas-mist bg-white px-6 py-4">
        {step > 1 && <button type="button" onClick={() => { setError(''); setStep(step - 1); }} className="mr-auto rounded-lg px-4 py-2 text-sm hover:bg-atlas-mist">Atrás</button>}
        <button type="submit" disabled={sending || githubLinked !== true || loadingGithub} className="inline-flex items-center gap-2 rounded-lg bg-atlas-red px-4 py-2 text-sm text-white hover:bg-atlas-ink disabled:opacity-50">
          {sending ? 'Creando…' : step === 3 ? (demo ? 'Enviar a aprobación' : 'Crear proyecto') : 'Siguiente'}
          {step < 3 && <IconChevronRight size={16} stroke={2} aria-hidden="true" />}
        </button>
      </footer>
    </form>
    {confirmClose && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" role="presentation">
      <section role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 id="discard-title" className="text-lg font-semibold">¿Cerrar el nuevo proyecto?</h3>
        <p id="discard-description" className="mt-2 text-sm text-atlas-muted">Se perderán los datos que ingresaste en este formulario.</p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button ref={continueButton} type="button" onClick={() => setConfirmClose(false)} className="px-2 text-sm font-medium hover:bg-atlas-mist">Continuar creando</button>
          <button type="button" onClick={() => { setConfirmClose(false); onClose(); }} className="rounded-lg bg-atlas-red px-4 py-2 text-sm font-medium text-white hover:bg-atlas-ink">Cerrar proyecto</button>
        </div>
      </section>
    </div>}
  </dialog>;
}
