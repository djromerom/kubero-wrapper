import { useState } from 'react';
import { api, type Project } from '../api';

export default function AdaptationReport({
  project,
  onRetry,
}: {
  project: Project;
  onRetry: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const report = project.adaptation_report;
  const labels: Record<string, string> = {
    compatible: 'Compatible',
    adapted: 'Adaptado',
    intervention_required: 'Requiere intervención',
    infrastructure_error: 'Error de infraestructura',
  };
  const retryAdaptation = async () => {
    setBusy(true);
    setError('');
    try {
      await api.retryAdaptation(project.id);
      onRetry();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-atlas-mist p-5">
      <h2 className="font-semibold">Adaptación del proyecto</h2>
      {project.status === 'adapting' ? (
        <p className="mt-3 text-sm">
          Kubero está preparando y empaquetando el proyecto antes de la revisión administrativa.
        </p>
      ) : report ? (
        <div className="mt-3 space-y-3 text-sm">
          <p className="font-medium">{labels[report.outcome] || report.outcome}</p>
          <p>{report.summary}</p>
          {report.build_strategy && (
            <p>
              Motor: {report.build_strategy} | Puerto: {report.port}
            </p>
          )}
          {report.changes?.map((text) => (
            <p key={text}>{text}</p>
          ))}
          <p className="break-all text-xs text-atlas-muted">
            Commit: {report.commit || project.source_commit} · Arquitectura:{' '}
            {report.platform || 'No verificada'}
          </p>
          <p>
            Construcción: {report.build_verified ? 'Verificada' : 'No completada'} · Funcionamiento:{' '}
            {report.runtime_verified ? 'Verificado' : 'Pendiente de comprobar en el despliegue'}
          </p>
          {report.components?.map((component) => (
            <p key={component.path}>
              {component.path} · {component.framework}
            </p>
          ))}
          {(report.blockers || []).length > 0 && (
            <div>
              <h3 className="font-medium text-atlas-red">Impedimentos</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {report.blockers?.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
          )}
          {(report.warnings || []).length > 0 && (
            <div>
              <h3 className="font-medium">Por revisar</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {report.warnings?.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-atlas-muted">
          Este proyecto todavía no tiene un reporte de adaptación.
        </p>
      )}
      {['pending', 'corrections', 'failed'].includes(project.status) && (
        <button disabled={busy} className="mt-4 text-sm text-atlas-red disabled:opacity-50" onClick={retryAdaptation}>
          {busy ? 'Solicitando…' : 'Volver a analizar y construir'}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-atlas-red">
          {error}
        </p>
      )}
    </section>
  );
}
