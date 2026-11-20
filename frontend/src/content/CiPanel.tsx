import { useState } from 'react';
import { api, type CiRun, type Project } from '../api';
import StatusBadge from './StatusBadge';

export default function CiPanel({ project, runs, onRefresh, readOnly }: {
  project: Project; runs: CiRun[]; onRefresh: () => Promise<void>; readOnly: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = project.ci;
  async function retry() {
    setBusy(true); setError('');
    try { await api.retryCi(project.id); await onRefresh(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <section className="space-y-4 rounded-xl border border-atlas-mist p-5" aria-label="Integración continua">
      <h2 className="font-semibold">Construcción de imagen · CI</h2>
      {current ? <>
        <StatusBadge status={`ci_${current.status}`} />
        <p role="status" className="text-sm text-atlas-muted">{current.message || 'Atlas está siguiendo la construcción en Woodpecker.'}</p>
        <dl className="space-y-2 break-all text-sm">
          <div><dt className="font-medium">Commit</dt><dd>{current.commit_sha}</dd></div>
          <div><dt className="font-medium">Plataforma</dt><dd>{current.platform}</dd></div>
          {current.pipeline_number && <div><dt className="font-medium">Ejecución Woodpecker</dt><dd>#{current.pipeline_number}</dd></div>}
          {current.image_reference && <div><dt className="font-medium">Imagen verificada</dt><dd>{current.image_reference}</dd></div>}
        </dl>
        {current.mode === 'repository-test' && <p className="text-sm text-amber-800">Prueba piloto con pipeline del repositorio. La configuración central aún no se ha validado.</p>}
        {!readOnly && current.completed_at && <button disabled={busy} onClick={() => void retry()} className="rounded-lg bg-atlas-red px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Solicitando…' : 'Construir versión actual de la rama'}</button>}
      </> : <p className="text-sm text-atlas-muted">Proyecto histórico. No se ha solicitado una construcción en el nuevo sistema CI.</p>}
      {error && <p role="alert" className="text-sm text-atlas-red">{error}</p>}
      {runs.length > 1 && <details><summary className="cursor-pointer text-sm">Historial de CI ({runs.length})</summary>
        <ul className="mt-3 space-y-3">{runs.map(run => <li key={run.id} className="flex flex-wrap items-center gap-3 text-xs"><StatusBadge status={`ci_${run.status}`} /><span>{run.commit_sha.slice(0, 12)}</span><time>{new Date(run.created_at).toLocaleString()}</time></li>)}</ul>
      </details>}
    </section>
  );
}
