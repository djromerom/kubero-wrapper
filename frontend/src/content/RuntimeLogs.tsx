import { useEffect, useState } from 'react';
import { api, type RuntimeLog } from '../api';

export default function RuntimeLogs({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<RuntimeLog[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    let busy = false;
    const load = async () => {
      if (document.hidden || busy) return;
      busy = true;
      if (active) setLoading(true);
      try {
        const logs = await api.runtimeLogs(id);
        if (active) {
          setEntries(logs);
          setError('');
        }
      } catch (cause) {
        if (active) setError((cause as Error).message);
      } finally {
        busy = false;
        if (active) setLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [id, open]);
  return (
    <details className="my-6 rounded-xl border border-atlas-mist p-5" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold">Logs de aplicación y servicios</summary>
      <p className="mt-3 text-xs text-atlas-muted">
        Últimas 100 líneas por contenedor. Se actualizan cada 10 segundos mientras este panel está
        abierto.{loading && ' Actualizando…'}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-atlas-red">
          {error}
        </p>
      )}
      {!loading && !error && !entries.length && (
        <p className="mt-3 text-sm text-atlas-muted">
          Todavía no hay contenedores con logs disponibles.
        </p>
      )}
      {entries.map((entry) => (
        <details key={`${entry.pod}/${entry.container}`} className="mt-4" open>
          <summary className="cursor-pointer break-all text-sm">
            {entry.container} · {entry.pod}
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-atlas-mist p-3 text-xs">
            {entry.logs}
          </pre>
        </details>
      ))}
    </details>
  );
}
