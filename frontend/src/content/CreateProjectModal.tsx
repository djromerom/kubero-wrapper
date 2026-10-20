import {
  fieldClassName,
  fieldLabelClassName,
  controlClassName,
  fieldHelperClassName,
} from '../shared/formStyles';
import { useEffect, useRef, useState } from 'react';
import { api, type GithubRepository } from '../api';
import GithubButton from '../shared/GithubButton';
import type { ProjectDraft } from './projectDraft';
import CustomSelect from './CustomSelect';
import { IconChevronRight } from '@tabler/icons-react';
import { useAuth } from '../login/AuthContext';
import { courseOptions } from './correctionFields';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}
const initial: ProjectDraft = {
  name: '',
  repo: '',
  branch: '',
  subdomain: '',
  purpose: '',
  course: '',
};
const validSubdomain = (name: string) => /^[a-z0-9](?:[a-z0-9-]{1,47}[a-z0-9])$/.test(name);

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
  const [githubRepositories, setGithubRepositories] = useState<GithubRepository[]>([]);
  const [githubBranches, setGithubBranches] = useState<string[]>([]);
  const [subdomainState, setSubdomainState] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'error'
  >('idle');

  useEffect(() => {
    if (confirmClose) continueButton.current?.focus();
  }, [confirmClose]);

  const update = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    const name = draft.subdomain.trim().toLowerCase();
    if (!open || !name || !validSubdomain(name)) {
      setSubdomainState('idle');
      return;
    }
    let active = true;
    setSubdomainState('checking');
    const timer = window.setTimeout(() => {
      api
        .subdomainAvailability(name)
        .then((result) => {
          if (active) setSubdomainState(result.available ? 'available' : 'taken');
        })
        .catch(() => {
          if (active) setSubdomainState('error');
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draft.subdomain, open]);

  async function loadRepositories() {
    setLoadingGithub(true);
    setError('');
    try {
      const response = await api.listGithubRepositories();
      setGithubRepositories(response.repositories);
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
    setGithubRepositories([]);
    setGithubBranches([]);
    dialog.current?.showModal();

    setGithubLinked(null);
    setLoadingGithub(true);
    api
      .githubStatus()
      .then((status) => {
        setGithubLinked(status.linked);
        setGithubLogin(status.login || '');
        if (status.linked) return loadRepositories();
      })
      .catch((cause) => setError((cause as Error).message))
      .finally(() => setLoadingGithub(false));
  }, [open]);

  async function connectGithub() {
    setError('');
    setLoadingGithub(true);
    try {
      await api.githubConnect();
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
      await api.githubDisconnect();
      setGithubLinked(false);
      setGithubLogin('');
      setGithubRepositories([]);
      setGithubBranches([]);
      setDraft((current) => ({ ...current, repo: '', branch: '' }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoadingGithub(false);
    }
  }

  async function selectRepository(fullName: string) {
    setError('');
    setDraft((current) => ({ ...current, repo: fullName, branch: '' }));
    setGithubBranches([]);
    if (!fullName) return;
    const repository = githubRepositories.find((item) => item.full_name === fullName);
    if (!repository) return;
    const [owner, repo] = repository.full_name.split('/');
    setLoadingGithub(true);
    try {
      const response = await api.listGithubBranches(owner, repo);
      const branchNames = response.branches.map((branch) => branch.name);
      const branch = branchNames.find((name) => name === 'main') || branchNames[0] || '';
      setGithubBranches(branchNames);
      setDraft((current) => ({ ...current, branch }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoadingGithub(false);
    }
  }

  function selectBranch(branch: string) {
    setDraft((current) => ({ ...current, branch }));
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
    if (
      step === 1 &&
      (projectName.length < 3 ||
        projectName.length > 50 ||
        !/^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u.test(projectName))
    ) {
      setError(
        'El nombre debe tener entre 3 y 50 caracteres. Usa letras, números, espacios o guiones; comienza y termina con una letra o un número.'
      );
      return;
    }
    if (step === 1 && (!draft.repo || !draft.branch)) {
      setError('Selecciona un repositorio y una rama.');
      return;
    }
    const subdomain = draft.subdomain.trim().toLowerCase();
    if (step === 2 && subdomain) {
      if (!validSubdomain(subdomain)) {
        setError(
          'La URL debe tener entre 3 y 49 caracteres: letras minúsculas, números y guiones; sin guiones al inicio o al final.'
        );
        return;
      }
      try {
        const available = (await api.subdomainAvailability(subdomain)).available;
        if (!available) {
          setSubdomainState('taken');
          setError('La URL ya existe. Elige otra.');
          return;
        }
      } catch (cause) {
        setError((cause as Error).message);
        return;
      }
    }
    if (step === 2 && !draft.purpose.trim()) {
      setError('Explica el propósito funcional del proyecto.');
      return;
    }
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    setSending(true);
    try {
      await api.createProject({
        name: projectName,
        repo_url: `https://github.com/${draft.repo}`,
        branch: draft.branch,
        requested_subdomain: subdomain,
        purpose: draft.purpose.trim(),
        course: draft.course || undefined,
      });
      onCreated();
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  }

  const handleCancel = (event: React.SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (confirmClose) setConfirmClose(false);
    else requestClose();
  };

  const handleBackdropClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target !== dialog.current || confirmClose) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      requestClose();
  };

  const previousStep = () => {
    setError('');
    setStep(step - 1);
  };

  const confirmDiscard = () => {
    setConfirmClose(false);
    onClose();
  };

  return (
    <dialog ref={dialog} onCancel={handleCancel} onClick={handleBackdropClick} aria-labelledby="create-title" className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl bg-white p-0 text-atlas-ink backdrop:bg-black/50">
      <form onSubmit={next} inert={confirmClose}>
        <header className="px-6 pt-6">
          <h2 id="create-title" className="text-2xl font-semibold">
            Nuevo proyecto
          </h2>
          <p className="text-sm text-atlas-muted">
            Registra tu repositorio y envíalo a revisión. Todavía no se iniciará la integración ni
            el despliegue.
          </p>
        </header>
        <ol className="relative flex items-center justify-between gap-2 border-b border-atlas-mist px-6 py-5 before:absolute before:inset-x-8 before:top-1/2 before:h-px before:bg-atlas-red before:content-[''] max-[480px]:gap-[.2rem] max-[480px]:px-3" aria-label="Pasos de registro">
          {['Repositorio', 'Información', 'Confirmar'].map((label, index) => (
            <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={`relative z-[1] inline-flex flex-none items-center gap-[.4rem] whitespace-nowrap rounded-full border border-atlas-red px-[.85rem] py-[.45rem] text-xs leading-[1.1rem] max-[480px]:gap-[.2rem] max-[480px]:px-[.4rem] max-[480px]:py-[.35rem] max-[480px]:text-[.625rem] ${step > index + 1 ? 'bg-atlas-red font-semibold text-white' : step === index + 1 ? 'bg-[#f8e8e8] font-semibold text-atlas-red' : 'bg-white text-atlas-ink'}`}>
              <span className={step > index + 1 ? 'text-white' : 'text-atlas-red'}>
                {index + 1}
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
        <div className="space-y-4 px-6 py-5">
          {step === 1 && (
            <div className="grid gap-5">
              <GithubButton linked={githubLinked === true} login={githubLogin} disabled={loadingGithub || githubLinked === null} onClick={githubLinked ? disconnectGithub : connectGithub} />

              <label className={fieldClassName}>
                <span className={fieldLabelClassName}>Nombre</span>
                <input autoFocus className={controlClassName} value={draft.name} onChange={(event) => update('name', event.target.value)} required minLength={3} maxLength={50} placeholder="Mi portafolio" />
              </label>

              {githubLinked === true && (
                <>
                  <CustomSelect label="Repositorio" value={draft.repo} disabled={loadingGithub} onChange={(value) => void selectRepository(value)} options={[ { value: '', label: 'Selecciona un repositorio' }, ...githubRepositories.map((repository) => ({ value: repository.full_name, label: repository.full_name, })), ]} />
                  <CustomSelect label="Rama" value={draft.branch} disabled={!draft.repo || loadingGithub} onChange={selectBranch} options={ !draft.repo ? [{ value: '', label: 'Selecciona primero un repositorio' }] : loadingGithub ? [{ value: '', label: 'Cargando ramas…' }] : !githubBranches.length ? [{ value: '', label: 'No hay ramas disponibles' }] : githubBranches.map((branch) => ({ value: branch, label: branch })) } />
                </>
              )}
            </div>
          )}
          {step === 2 && (
            <div className="grid gap-5">
              <div className={fieldClassName}>
                <label htmlFor="project-url" className={fieldLabelClassName}>
                  URL
                </label>
                <div className="flex items-center gap-2">
                  <input id="project-url" className={`${controlClassName} min-w-0 flex-1`} value={draft.subdomain} onChange={(event) => update('subdomain', event.target.value.toLowerCase())} maxLength={49} autoComplete="off" aria-invalid={Boolean( draft.subdomain && (!validSubdomain(draft.subdomain) || subdomainState === 'taken') )} aria-describedby="project-url-preview project-url-status" placeholder="nombre" />
                  <span className="shrink-0 text-sm text-atlas-muted">.dominio.edu.co</span>
                </div>
                <span id="project-url-preview" className={fieldHelperClassName}>
                  El enlace de su página web será {draft.subdomain || 'nombre'}.dominio.edu.co
                </span>
                <span id="project-url-status" role="status" className={`text-xs ${subdomainState === 'taken' || subdomainState === 'error' ? 'text-atlas-red' : 'text-atlas-muted'}`}>
                  {!draft.subdomain
                    ? 'Si lo dejas vacío, se asignará una URL aleatoria basada en el nombre del repositorio.'
                    : !validSubdomain(draft.subdomain)
                      ? 'Usa entre 3 y 49 letras minúsculas, números o guiones; comienza y termina con letra o número.'
                      : subdomainState === 'checking'
                        ? 'Comprobando disponibilidad…'
                        : subdomainState === 'taken'
                          ? 'Esta URL ya existe. Elige otra.'
                          : subdomainState === 'available'
                            ? 'URL disponible.'
                            : subdomainState === 'error'
                              ? 'No se pudo comprobar la disponibilidad.'
                              : ''}
                </span>
              </div>
              <label className={fieldClassName}>
                <span className={fieldLabelClassName}>Descripción</span>
                <textarea className={controlClassName} rows={2} required value={draft.purpose} onChange={(event) => update('purpose', event.target.value)} placeholder="Explica qué hace la aplicación y para qué se utilizará" />
              </label>
              <CustomSelect label="Curso" value={draft.course} options={courseOptions} onChange={(value) => setDraft((current) => ({ ...current, course: value }))} />
            </div>
          )}
          {step === 3 && (
            <dl className="divide-y divide-atlas-mist text-sm">
              {Object.entries({
                Nombre: draft.name,
                Repositorio: draft.repo,
                Rama: draft.branch,
                URL: draft.subdomain
                  ? `${draft.subdomain}.dominio.edu.co`
                  : 'Se asignará automáticamente a partir del repositorio',
                Descripción: draft.purpose,
                Curso: draft.course || 'No pertenece',
                Responsable: user?.name || 'Sin nombre',
              }).map(([label, value]) => (
                <div key={label} className="grid gap-1 py-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                  <dt className="text-xs text-atlas-muted">{label}</dt>
                  <dd className="min-w-0 break-words font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {error && (
            <p role="alert" className="text-sm text-atlas-red">
              {error}
            </p>
          )}
        </div>
        <footer className="flex items-center justify-end gap-3 border-t border-atlas-mist bg-white px-6 py-4">
          {step > 1 && (
            <button type="button" onClick={previousStep} className="mr-auto rounded-lg px-4 py-2 text-sm hover:bg-atlas-mist">
              Atrás
            </button>
          )}
          <button type="submit" disabled={sending || githubLinked !== true || loadingGithub} className="inline-flex items-center gap-2 rounded-lg bg-atlas-red px-4 py-2 text-sm text-white hover:bg-atlas-ink disabled:opacity-50">
            {sending ? 'Enviando…' : step === 3 ? 'Enviar solicitud' : 'Siguiente'}
            {step < 3 && <IconChevronRight size={16} stroke={2} aria-hidden="true" />}
          </button>
        </footer>
      </form>
      {confirmClose && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 id="discard-title" className="text-lg font-semibold">
              ¿Cerrar el nuevo proyecto?
            </h3>
            <p id="discard-description" className="mt-2 text-sm text-atlas-muted">
              Se perderán los datos que ingresaste en este formulario.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button ref={continueButton} type="button" onClick={() => setConfirmClose(false)} className="px-2 text-sm font-medium hover:bg-atlas-mist">
                Continuar creando
              </button>
              <button type="button" onClick={confirmDiscard} className="rounded-lg bg-atlas-red px-4 py-2 text-sm font-medium text-white hover:bg-atlas-ink">
                Cerrar proyecto
              </button>
            </div>
          </section>
        </div>
      )}
    </dialog>
  );
}
