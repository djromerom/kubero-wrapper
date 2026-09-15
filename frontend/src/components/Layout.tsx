import NotificationsPanel from './NotificationsPanel';
import { useEffect, useRef, useState } from 'react';
import ProfilePanel from './ProfilePanel';
import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import AtlasBrand from './AtlasBrand';

function AccountIcon({ kind }: { kind: 'user' | 'bell' | 'logout' }) {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
    {kind === 'user' ? <><circle cx="12" cy="7" r="4" /><path d="M5 21v-3a7 7 0 0 1 14 0v3" /></> : kind === 'bell' ? <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></> : <><path d="M10 4H5v16h5M10 12h11m-4-4 4 4-4 4" /></>}
  </svg>;
}

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
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
          <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{panel === 'profile' ? 'Mi perfil' : 'Notificaciones'}</h2></div>
          {panel === 'profile' ? <ProfilePanel user={user} /> : <NotificationsPanel onClose={() => setPanel(null)} />}
        </section>}
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Ver mi perfil" aria-expanded={panel === 'profile'} aria-controls={panel === 'profile' ? 'account-panel' : undefined} onClick={() => setPanel(panel === 'profile' ? null : 'profile')} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-2 text-left hover:bg-white/60">
            <AccountIcon kind="user" /><span className="min-w-0"><span className="block break-words text-sm font-semibold">{user?.name}</span><span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-atlas-red">{role}</span></span>
          </button>
          <button type="button" aria-label="Notificaciones" aria-expanded={panel === 'notifications'} aria-controls={panel === 'notifications' ? 'account-panel' : undefined} onClick={() => setPanel(panel === 'notifications' ? null : 'notifications')} className="rounded-lg p-2 hover:bg-white/60"><AccountIcon kind="bell" /></button>
        </div>
        <button type="button" onClick={() => { logout(); navigate('/login'); }} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-black/15 px-3 py-3 text-sm font-semibold hover:bg-white"><AccountIcon kind="logout" />Cerrar sesión</button>
      </div>
    </aside>
    <div className="min-w-0">
      <main id="main-content" className="mx-auto max-w-7xl p-6 lg:p-10"><Outlet /></main>
    </div>
  </div>;
}
