import { NavLink } from 'react-router-dom';
import { IconFolder, IconFolders, IconServer } from '@tabler/icons-react';
import { useAuth } from '../login/AuthContext';

export default function SidebarNavigation({ collapsed }: { collapsed: boolean }) {
  const { isAdmin } = useAuth();
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-lg p-2 text-sm font-medium ${collapsed ? 'justify-center' : 'justify-start'} ${isActive ? 'bg-atlas-red text-white' : 'text-atlas-muted'}`;
  return (
    <nav aria-label="Navegación principal" className="mt-4 flex flex-wrap gap-2 md:flex-col md:flex-nowrap">
      <NavLink end to="/" aria-label="Mis proyectos" title={collapsed ? 'Mis proyectos' : undefined} className={navClass}>
        <IconFolder size={21} stroke={2.4} aria-hidden="true" className="shrink-0" />
        {!collapsed && <span>Mis proyectos</span>}
      </NavLink>
      {isAdmin && (
        <NavLink end to="/admin" aria-label="Clúster" title={collapsed ? 'Clúster' : undefined} className={navClass}>
          <IconServer size={21} stroke={1.8} aria-hidden="true" className="shrink-0" />
          {!collapsed && <span>Clúster</span>}
        </NavLink>
      )}
      {isAdmin && (
        <NavLink to="/admin/projects" aria-label="Proyectos de la plataforma" title={collapsed ? 'Proyectos de la plataforma' : undefined} className={navClass}>
          <IconFolders size={21} stroke={1.8} aria-hidden="true" className="shrink-0" />
          {!collapsed && <span>Proyectos de la plataforma</span>}
        </NavLink>
      )}
    </nav>
  );
}
