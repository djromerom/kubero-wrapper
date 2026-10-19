import AdaptationReport from './AdaptationReport';
import { fieldClassName, fieldLabelClassName, controlClassName } from '../shared/formStyles';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Project, type Build, type DeploymentStatus } from '../api';
import { useAuth } from '../login/AuthContext';
import StatusBadge from './StatusBadge';
import DeploymentSettings from './DeploymentSettings';
import RuntimeLogs from './RuntimeLogs';
import { IconExternalLink } from '@tabler/icons-react';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loadError, setLoadError] = useState('');
  const [project, setProject] = useState<Project | null>(null);
  const [builds, setBuilds] = useState<Build[]>([]);
  const [loading, setLoading] = useState(true);
  const [webhook, setWebhook] = useState<{ webhook_url: string; webhook_secret: string } | null>(
    null
  );
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus | null>(null);
  const [loadingDeployment, setLoadingDeployment] = useState(false);
  const [revisedPurpose, setRevisedPurpose] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [resubmitting, setResubmitting] = useState(false);
  const admissionStatus = project?.status;

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, b, w] = await Promise.all([
        api.getProject(id),
        api.listBuilds(id),
        api.getWebhook(id).catch(() => null),
      ]);
      setProject(p);
      setRevisedPurpose(p.purpose || '');
      setBuilds(b);
      setWebhook(w);
    } catch (cause) {
      setLoadError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadDeploymentStatus = useCallback(async () => {
    if (!id) return;
    setLoadingDeployment(true);
    try {
      const status = await api.getDeploymentStatus(id);
      setDeploymentStatus(status);
    } catch (error) {
      console.error('Failed to load deployment status:', error);
    } finally {
      setLoadingDeployment(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (
      admissionStatus &&
      !['adapting', 'pending', 'corrections', 'approved'].includes(admissionStatus)
    )
      void loadDeploymentStatus();
  }, [loadDeploymentStatus, admissionStatus]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    let refreshing = false;
    const refreshProject = async () => {
      if (document.hidden || refreshing) return;
      refreshing = true;
      try {
        const [updatedProject, updatedBuilds] = await Promise.all([
          api.getProject(id),
          api.listBuilds(id),
        ]);
        if (active) {
          setProject(updatedProject);
          setBuilds(updatedBuilds);
        }
      } catch {
        // Keep the last available project state and try again on the next poll.
      } finally {
        refreshing = false;
      }
    };
    const interval = window.setInterval(() => {
      void refreshProject();
    }, 5000);
    document.addEventListener('visibilitychange', refreshProject);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshProject);
    };
  }, [id]);

  // Poll deployment status every 10 seconds
  useEffect(() => {
    if (
      !admissionStatus ||
      ['adapting', 'pending', 'corrections', 'approved'].includes(admissionStatus)
    )
      return;
    const interval = setInterval(() => {
      loadDeploymentStatus();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadDeploymentStatus, admissionStatus]);

  const handleDelete = async () => {
    if (!id || !confirm('¿Seguro que quieres eliminar este proyecto?')) return;
    await api.deleteProject(id);
    navigate('/');
  };

  const translateReason = (reason: string): string => {
    const translations: Record<string, string> = {
      Scheduled: 'Programado',
      Pulling: 'Descargando imagen',
      Pulled: 'Imagen descargada',
      Created: 'Contenedor creado',
      Started: 'Contenedor iniciado',
      Failed: 'Falló',
      BackOff: 'Reintentando',
      FailedScheduling: 'No se pudo programar',
      Unhealthy: 'Fallo en chequeo de salud',
      FailedMount: 'Error al montar volumen',
    };
    return translations[reason] || reason;
  };

  if (loading) return <p className="text-atlas-muted">Cargando...</p>;
  if (!project)
    return (
      <p role="alert" className="text-atlas-red">
        {loadError || 'Proyecto no encontrado'}
      </p>
    );

  const submitCorrections = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id) return;
    setResubmitting(true);
    setReviewError('');
    try {
      setProject(await api.resubmitProject(id, revisedPurpose.trim()));
    } catch (cause) {
      setReviewError((cause as Error).message);
    } finally {
      setResubmitting(false);
    }
  };

  if (['adapting', 'pending', 'corrections', 'approved'].includes(project.status))
    return (
      <div className="max-w-3xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <p className="mt-1 break-all text-sm text-atlas-muted">
              {project.repo_url} · {project.branch}
            </p>
          </div>
          <StatusBadge status={project.status} />
        </header>
        <section className="rounded-xl border border-atlas-mist p-5">
          <h2 className="font-semibold">Solicitud de proyecto</h2>
          <dl className="mt-4 space-y-3 text-sm">
            {Object.entries({
              Descripción: project.purpose || 'No disponible',
              Curso: project.course || 'No aplica',
              'URL propuesta': project.requested_subdomain
                ? `${project.requested_subdomain}.dominio.edu.co`
                : 'No disponible',
            }).map(([label, value]) => (
              <div key={label}>
                <dt className="text-atlas-muted">{label}</dt>
                <dd className="mt-1 break-all">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-atlas-muted">
            La URL está reservada, pero la página todavía no está publicada.
          </p>
        </section>
        <AdaptationReport project={project} onRetry={() => void load()} />
        <DeploymentSettings id={project.id} status={project.status} readOnly={user?.role === 'admin'} onSaved={() => void load()} />
        <RuntimeLogs id={project.id} />
        {builds.length > 0 && (
          <section className="rounded-xl border border-atlas-mist p-5">
            <h2 className="font-semibold">Logs de construcción</h2>
            {builds.map((build) => (
              <details key={build.id} open={build.id === builds[0].id} className="mt-3">
                <summary className="cursor-pointer text-sm">
                  {new Date(build.created_at).toLocaleString('es-CO')} · {build.status}
                </summary>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs text-atlas-muted">
                  {build.logs || 'Sin logs'}
                </pre>
              </details>
            ))}
          </section>
        )}
        {project.status === 'pending' && (
          <p className="rounded-xl bg-amber-50 p-5 text-sm">
            El proyecto espera revisión administrativa. Consulta el reporte de adaptación antes de
            la aprobación.
          </p>
        )}
        {project.status === 'approved' && (
          <p className="rounded-xl bg-green-50 p-5 text-sm">
            Proyecto aprobado. El despliegue está autorizado y espera un ejecutor configurado.
          </p>
        )}
        {project.status === 'corrections' && (
          <section className="rounded-xl border border-amber-300 bg-amber-50 p-5">
            <h2 className="font-semibold">Correcciones solicitadas</h2>
            <p className="mt-2 text-sm">{project.review_note}</p>
            {user?.role !== 'admin' && (
              <form className="mt-4 space-y-3" onSubmit={submitCorrections}>
                <label className={fieldClassName}>
                  <span className={fieldLabelClassName}>Propósito actualizado</span>
                  <textarea required className={controlClassName} value={revisedPurpose} onChange={(event) => setRevisedPurpose(event.target.value)} placeholder={project.purpose || ''} />
                </label>
                {reviewError && (
                  <p role="alert" className="text-sm text-atlas-red">
                    {reviewError}
                  </p>
                )}
                <button disabled={resubmitting} className="rounded-lg bg-atlas-red px-4 py-2 text-sm text-white disabled:opacity-50">
                  Enviar a validación
                </button>
              </form>
            )}
          </section>
        )}
      </div>
    );

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-sm text-atlas-muted mt-1">
            {project.repo_url} ({project.branch})
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={project.status} />
          {user?.role !== 'admin' && (
            <button onClick={handleDelete} className="text-sm text-atlas-red hover:text-atlas-red">
              Eliminar
            </button>
          )}
        </div>
      </div>

      <section className="mb-6 rounded-lg bg-white p-4">
        <h2 className="mb-3 font-semibold">Información del proyecto</h2>
        <dl className="text-sm">
          <div>
            <dt className="text-atlas-muted">Proyecto creado</dt>
            <dd className="mt-1">{new Date(project.created_at).toLocaleDateString('es-CO')}</dd>
          </div>
        </dl>
      </section>

      <AdaptationReport project={project} onRetry={() => void load()} />
      <DeploymentSettings id={project.id} status={project.status} readOnly={user?.role === 'admin'} onSaved={() => void load()} />
      <RuntimeLogs id={project.id} />

      {deploymentStatus && (
        <div className="bg-white rounded-lg p-4 mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
            <h3 className="font-semibold">Estado del despliegue (Kubero)</h3>
            {loadingDeployment && <span className="text-xs text-atlas-muted">Actualizando...</span>}
          </div>
          {!deploymentStatus.kubero_status ? (
            <p className="text-sm text-atlas-muted">
              El despliegue de este proyecto aún no está disponible.
            </p>
          ) : project.status === 'running' && !deploymentStatus.kubero_status.status.phase ? (
            <p className="text-sm text-atlas-muted">
              La aplicación está publicada y respondió correctamente por su dominio local.
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-atlas-muted">Fase:</span>
                <span className="font-medium">{deploymentStatus.kubero_status.status.phase}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-atlas-muted">Réplicas (listas / disponibles / total):</span>
                <span className="font-medium">
                  {deploymentStatus.kubero_status.status.readyReplicas} /{' '}
                  {deploymentStatus.kubero_status.status.availableReplicas} /{' '}
                  {deploymentStatus.kubero_status.status.replicas}
                </span>
              </div>
              {deploymentStatus.kubero_status.status.conditions.length > 0 && (
                <div className="mt-3 pt-3 border-t border-atlas-mist">
                  <span className="text-atlas-muted block mb-2">Condiciones:</span>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {deploymentStatus.kubero_status.status.conditions.map((cond, idx) => (
                      <div key={idx} className="text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{cond.type}</span>
                          <span className={`text-xs ${cond.status === 'True' ? 'text-green-600' : cond.status === 'False' ? 'text-red-600' : 'text-yellow-600'}`}>
                            {cond.status}
                          </span>
                        </div>
                        {cond.reason && (
                          <span className="text-atlas-muted ml-2">{cond.reason}</span>
                        )}
                        {cond.message && (
                          <p className="text-atlas-muted mt-1 break-all">{cond.message}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {deploymentStatus.events.length > 0 && (
                <div className="mt-3 pt-3 border-t border-atlas-mist">
                  <span className="text-atlas-muted block mb-2">Eventos de pods:</span>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {deploymentStatus.events.map((event, idx) => (
                      <div key={idx} className="border-b border-atlas-mist pb-2 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium ${event.type === 'Warning' ? 'text-red-600' : event.type === 'Error' ? 'text-red-600' : 'text-green-600'}`}>
                            {event.type}
                          </span>
                          <span className="text-xs text-atlas-muted">
                            {translateReason(event.reason)}
                          </span>
                          {event.last_timestamp && (
                            <span className="text-xs text-atlas-muted ml-auto">
                              {new Date(event.last_timestamp).toLocaleTimeString('es-CO')}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-atlas-muted mt-1 break-all">{event.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {deploymentStatus.kubero_status.status.url &&
                deploymentStatus.kubero_status.status.availableReplicas > 0 && (
                  <div className="mt-3 pt-3 border-t border-atlas-mist">
                    <span className="text-atlas-muted block mb-1">URL de la aplicación:</span>
                    <a href={deploymentStatus.kubero_status.status.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-atlas-red hover:underline">
                      <span>{deploymentStatus.kubero_status.status.url}</span>
                      <IconExternalLink size={16} stroke={1.8} aria-hidden="true" className="shrink-0" />
                    </a>
                  </div>
                )}
            </div>
          )}
        </div>
      )}

      {project.status === 'running' && project.domain && (
        <div className="bg-white rounded-lg p-4 mb-6">
          <p className="text-sm text-atlas-muted">Aplicación disponible:</p>
          <a href={`http://${project.domain}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-atlas-red hover:underline">
            <span>{`http://${project.domain}`}</span>
            <IconExternalLink size={16} stroke={1.8} aria-hidden="true" className="shrink-0" />
          </a>
        </div>
      )}

      {webhook && (
        <div className="bg-white rounded-lg p-4 mb-6">
          <h3 className="font-semibold mb-2">Configuración del webhook</h3>
          <p className="text-sm text-atlas-muted">URL:</p>
          <code className="block bg-atlas-mist rounded-sm px-3 py-2 mt-1 text-sm break-all">
            {webhook.webhook_url}
          </code>
          <p className="text-sm text-atlas-muted mt-3">Secreto:</p>
          <code className="block bg-atlas-mist rounded-sm px-3 py-2 mt-1 text-sm">
            {webhook.webhook_secret}
          </code>
        </div>
      )}

      <div className="bg-white rounded-lg p-4">
        <h3 className="font-semibold mb-4">Builds</h3>
        {builds.length === 0 ? (
          <p className="text-atlas-muted text-sm">Todavía no hay ejecuciones de build.</p>
        ) : (
          <div className="space-y-3">
            {builds.map((b) => (
              <div key={b.id} className="bg-atlas-mist rounded-sm p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-atlas-muted">
                    {b.commit_message || b.commit_sha?.slice(0, 7) || 'Desconocido'}
                  </span>
                  <StatusBadge status={b.status} />
                </div>
                {b.logs && (
                  <pre className="text-xs text-atlas-muted mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words">
                    {b.logs}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
