import { useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import type { Build } from '../api';
import LogOutput, { CopyLogButton } from '../shared/LogOutput';
import StatusBadge from './StatusBadge';

export default function BuildsList({ builds }: { builds: Build[] }) {
  const [selection, setSelection] = useState<{ latestId: string; openId: string | null } | null>(null);
  const latestId = builds[0]?.id;
  const openId = selection?.latestId === latestId ? selection?.openId : latestId;

  if (!builds.length) return <p className="text-sm text-atlas-muted">Todavía no hay ejecuciones de build.</p>;

  return (
    <div className="space-y-3">
      {builds.map((build) => {
        const expanded = build.id === openId;
        const logsId = `build-logs-${build.id}`;

        return (
          <div key={build.id} className="rounded-sm bg-atlas-mist p-3">
            <div className="flex items-center gap-2">
              <button type="button" aria-expanded={expanded} aria-controls={logsId} onClick={() => setSelection({ latestId, openId: expanded ? null : build.id })} className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-atlas-red">
                <IconChevronDown size={18} stroke={1.8} aria-hidden="true" className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                <span className="min-w-0">
                  <span className="text-atlas-muted">
                    <code>{build.commit_sha?.slice(0, 7) || 'Desconocido'}</code>
                    {build.id === latestId && <span className="ml-1">(actual)</span>}
                  </span>
                  {build.commit_message && <span className="mt-1 block break-words">{build.commit_message}</span>}
                  <span className="mt-1 block text-xs text-atlas-muted">{new Date(build.created_at).toLocaleString('es-CO')}</span>
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <StatusBadge status={build.status} />
                <CopyLogButton text={build.logs || ''} />
              </div>
            </div>
            <div id={logsId} hidden={!expanded}>
              <LogOutput text={build.logs || ''} showCopy={false} className="mt-2 text-atlas-muted" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
