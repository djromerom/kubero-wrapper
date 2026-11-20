import { useState } from 'react';
import { api, type Project } from '../api';

export default function ProjectDeletion({ project, onRequested, onDeleted }: { project: Project; onRequested: (project: Project) => void; onDeleted: () => void }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const requested = Boolean(project.deletion_requested_at);

  async function remove() {
    if (!requested && !confirm('Se archivará el proyecto en Atlas. Las imágenes y el historial se conservan; no se eliminarán recursos externos. ¿Archivar proyecto?')) return;
    setSending(true);
    setError('');
    let accepted = false;
    try {
      const result = await api.deleteProject(project.id);
      accepted = true;
      if (result.deleted) onDeleted();
      else onRequested(await api.getProject(project.id));
    } catch (cause) {
      if ((cause as { status?: number }).status === 404 && (accepted || requested)) onDeleted();
      else setError((cause as Error).message);
    } finally { setSending(false); }
  }

  if (!project.ci_managed) return <p className="text-sm text-atlas-muted">Los recursos históricos se conservan. Su retirada requiere la integración de CD.</p>;

  return (
    <section aria-label="Archivar proyecto" className={`my-5 rounded-xl border p-4 ${requested ? 'border-amber-300 bg-amber-50' : 'border-atlas-mist'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{requested ? 'Eliminación del proyecto' : 'Archivar proyecto'}</h2>
          <p role="status" className="mt-1 text-sm text-atlas-muted">
            {project.deletion_error ? 'La eliminación no terminó. El proyecto sigue visible y puedes reintentar.' : requested ? 'Solicitud histórica conservada. La retirada de recursos requiere la futura integración de CD.' : 'Archiva el proyecto sin eliminar imágenes ni recursos externos.'}
          </p>
        </div>
        {(!requested || project.deletion_error) && (
          <button type="button" disabled={sending || project.status === 'building'} onClick={() => void remove()} className="rounded-lg bg-atlas-red px-4 py-2 text-sm text-white disabled:opacity-50">
            {sending ? 'Solicitando…' : requested ? 'Reintentar eliminación' : 'Archivar'}
          </button>
        )}
      </div>
      {project.status === 'building' && !requested && <p className="mt-2 text-xs text-atlas-muted">Espera a que termine la construcción antes de eliminar.</p>}
      {(error || project.deletion_error) && <p role="alert" className="mt-3 break-words text-sm text-atlas-red">{error || project.deletion_error}</p>}
    </section>
  );
}
