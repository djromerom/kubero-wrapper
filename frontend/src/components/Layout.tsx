import NotificationsPanel from './NotificationsPanel';
import { useEffect, useRef, useState } from 'react';
import ProfilePanel from './ProfilePanel';
import { Outlet, NavLink, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import AtlasBrand from './AtlasBrand';
import { IconBell, IconUser } from '@tabler/icons-react';

function AccountIcon({ kind }: { kind: 'user' | 'bell' }) {
  const Icon = kind === 'user' ? IconUser : IconBell;
  return <Icon size={21} stroke={1.8} aria-hidden="true" className="shrink-0" />;
}

export default function Layout() {
  const { user, isAdmin } = useAuth();
  const [panel, setPanel] = useState<'profile' | 'notifications' | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const role = isAdmin ? 'Administrador' : 'Desarrollador';
  useEffect(() => {
    if (!panel) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountRef.current?.contains(event.target)) setPanel(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [panel]);
  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Saltar al contenido</a>
    <aside className="app-sidebar">
      <Link to="/" aria-label="Atlas, inicio"><AtlasBrand /></Link>
      <nav aria-label="Navegación principal" className="mt-4 flex flex-col gap-2">
        <NavLink end to="/" className={({ isActive }) => `sidebar-link ${isActive ? 'selected' : ''}`}>Mis proyectos</NavLink>
        {isAdmin && <NavLink end to="/admin" className={({ isActive }) => `sidebar-link ${isActive ? 'selected' : ''}`}>Clúster</NavLink>}
        {isAdmin && <NavLink to="/admin/projects" className={({ isActive }) => `sidebar-link ${isActive ? 'selected' : ''}`}>Proyectos de la plataforma</NavLink>}
      </nav>
      <div ref={accountRef} className="sidebar-account" onKeyDown={event => { if (event.key === 'Escape') { setPanel(null); } }}>
        {panel && <section id="account-panel" aria-label={panel === 'profile' ? 'Mi perfil' : 'Notificaciones'} className="account-panel">
          {panel === 'notifications' && <h2 className="mb-2 text-sm font-semibold">Notificaciones</h2>}
          {panel === 'profile' ? <ProfilePanel user={user} /> : <NotificationsPanel onClose={() => setPanel(null)} />}
        </section>}
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Ver mi perfil" aria-expanded={panel === 'profile'} aria-controls={panel === 'profile' ? 'account-panel' : undefined} onClick={() => setPanel(panel === 'profile' ? null : 'profile')} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left hover:bg-white/60">
            <AccountIcon kind="user" /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{user?.name}</span><span className="block text-xs font-semibold text-atlas-red">{role}</span></span>
          </button>
          <button type="button" aria-label="Notificaciones" aria-expanded={panel === 'notifications'} aria-controls={panel === 'notifications' ? 'account-panel' : undefined} onClick={() => setPanel(panel === 'notifications' ? null : 'notifications')} className="rounded-lg p-2 hover:bg-white/60"><AccountIcon kind="bell" /></button>
        </div>
      </div>
    </aside>
    <div className="min-w-0">
      <main id="main-content" className="mx-auto max-w-7xl p-6 lg:p-10"><Outlet /></main>
    </div>
  </div>;
}
