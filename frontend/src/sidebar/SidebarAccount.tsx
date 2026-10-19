import { useEffect, useRef, useState } from 'react';
import { IconBell, IconUser } from '@tabler/icons-react';
import { useAuth } from '../login/AuthContext';
import ProfilePanel from './ProfilePanel';
import NotificationsPanel from './NotificationsPanel';

interface Props {
  collapsed: boolean;
  transitioning: boolean;
}

export default function SidebarAccount({ collapsed, transitioning }: Props) {
  const { user, isAdmin } = useAuth();
  const role = isAdmin ? 'Administrador' : 'Desarrollador';
  const [panel, setPanel] = useState<'profile' | 'notifications' | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPanel(null);
  }, [collapsed, transitioning]);
  useEffect(() => {
    if (!panel) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountRef.current?.contains(event.target))
        setPanel(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [panel]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') setPanel(null);
  }

  return (
    <div ref={accountRef} className="relative mt-4 border-t border-black/10 pt-2 md:mt-auto" onKeyDown={handleKeyDown}>
      {panel && (
        <section id="account-panel" aria-label={panel === 'profile' ? 'Mi perfil' : 'Notificaciones'} className={`absolute bottom-full left-0 z-50 mb-3 max-h-[60dvh] overflow-y-auto rounded-xl border border-atlas-mist bg-white p-4 shadow-lg ${collapsed ? (panel === 'profile' ? 'w-80 max-w-[calc(100vw-2.5rem)]' : 'w-64') : 'w-full max-w-full'}`}>
          {panel === 'notifications' && (
            <h2 className="mb-2 text-sm font-semibold">Notificaciones</h2>
          )}
          {panel === 'profile' ? (
            <ProfilePanel user={user} onClose={() => setPanel(null)} />
          ) : (
            <NotificationsPanel />
          )}
        </section>
      )}
      <div className={`flex items-center gap-2 ${collapsed ? 'flex-col' : ''}`}>
        <button type="button" aria-label="Ver mi perfil" title={collapsed ? 'Ver mi perfil' : undefined} aria-expanded={panel === 'profile'} aria-controls={panel === 'profile' ? 'account-panel' : undefined} onClick={() => setPanel(panel === 'profile' ? null : 'profile')} className={`flex min-w-0 px-2 py-1 items-center gap-3 text-left ${collapsed ? 'justify-center p-2' : 'flex-1'}`}>
          <IconUser size={21} stroke={1.8} aria-hidden="true" className="shrink-0" />
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{user?.name}</span>
              <span className="block text-xs font-semibold text-atlas-red">{role}</span>
            </span>
          )}
        </button>
        <button type="button" aria-label="Notificaciones" aria-expanded={panel === 'notifications'} aria-controls={panel === 'notifications' ? 'account-panel' : undefined} onClick={() => setPanel(panel === 'notifications' ? null : 'notifications')} className="p-2">
          <IconBell size={21} stroke={1.8} aria-hidden="true" className="shrink-0" />
        </button>
      </div>
    </div>
  );
}
