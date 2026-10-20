import { useState } from 'react';
import { api, type Project } from '../api';

export default function BuildReport({ project, onRetry }: { project: Project; onRetry: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const report = project.adaptation_report;
  if (!['approved', 'building', 'running', 'failed'].includes(project.status)) return null;

  async function retry() {
    setBusy(true);
    setError('');
    try {
      await api.retryDeployment(project.id);
      onRetry();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-atlas-mist p-5">
      <h2 className="font-semibold">Construcción y despliegue</h2>
      <p className="mt-3 text-sm">
        {report?.summary || (project.status === 'approved'
          ? 'Esperando al ejecutor para construir el Dockerfile del commit presentado.'
          : project.status === 'failed'
            ? 'La construcción o el despliegue falló. Consulta los logs para conocer la causa.'
            : project.status === 'running'
              ? 'La aplicación está desplegada.'
              : 'Kubero está construyendo la imagen y preparando la aplicación.')}
      </p>
      {report && (
        <dl className="mt-3 space-y-2 break-all text-sm">
          <div>
            <dt className="text-atlas-muted">Commit</dt>
            <dd>{report.commit || project.source_commit}</dd>
          </div>
          <div>
            <dt className="text-atlas-muted">Imagen</dt>
            <dd>{report.build_verified ? 'Construida' : 'Pendiente'}</dd>
          </div>
          <div>
            <dt className="text-atlas-muted">Disponibilidad</dt>
            <dd>{report.runtime_verified ? 'Verificada' : 'Pendiente'}</dd>
          </div>
        </dl>
      )}
      {project.status === 'failed' && (
        <button disabled={busy} onClick={() => void retry()} className="mt-4 text-sm text-atlas-red disabled:opacity-50">
          {busy ? 'Solicitando…' : 'Reintentar con la versión actual de la rama'}
        </button>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-atlas-red">{error}</p>}
    </section>
  );
}
