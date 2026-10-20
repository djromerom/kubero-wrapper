import { useEffect, useState } from 'react';
import { api, type DeploymentConfig } from '../api';
import DeploymentFields from './DeploymentFields';

export default function DeploymentSettings({
  id,
  status,
  readOnly,
  onSaved,
}: {
  id: string;
  status: string;
  readOnly: boolean;
  onSaved: () => void;
}) {
  const [config, setConfig] = useState<DeploymentConfig | null>(null);
  const [error, setError] = useState('');
  const [valid, setValid] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .getConfiguration(id)
      .then((value) => {
        if (active) setConfig(value);
      })
      .catch((cause) => {
        if (active) setError((cause as Error).message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  const locked = readOnly || ['building', 'approved'].includes(status);
  const saveConfiguration = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!config || locked || !valid) return;
    setSaving(true);
    setError('');
    try {
      await api.saveConfiguration(id, config);
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="my-6 rounded-xl border border-atlas-mist p-5">
      <summary className="cursor-pointer font-semibold">Configuración de despliegue</summary>
      {config && (
        <form className="mt-5 space-y-4" onSubmit={saveConfiguration}>
          <DeploymentFields key={id} value={config} onChange={setConfig} onValidityChange={setValid} disabled={locked || saving} />
          {!readOnly && (
            <>
              <p className="text-xs text-atlas-muted">
                {['pending', 'corrections'].includes(status)
                  ? 'Guardar actualiza la configuración de la solicitud. La construcción requiere aprobación administrativa.'
                  : 'Guardar programa un nuevo despliegue. La admisión del proyecto ya fue aprobada.'}
              </p>
              <button disabled={locked || !valid || saving} className="rounded-lg bg-atlas-red px-4 py-2 text-sm text-white disabled:opacity-50">
                {saving ? 'Guardando…' : ['pending', 'corrections'].includes(status) ? 'Guardar configuración' : 'Guardar y desplegar'}
              </button>
            </>
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-atlas-red">
          {error}
        </p>
      )}
    </details>
  );
}
