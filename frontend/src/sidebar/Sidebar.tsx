import type { RefObject } from 'react';
import { Link } from 'react-router-dom';
import AtlasBrand from '../shared/AtlasBrand';
import SidebarNavigation from './SidebarNavigation';
import SidebarAccount from './SidebarAccount';
import SidebarToggle from './SidebarToggle';

interface Props {
  collapsed: boolean;
  transitioning: boolean;
  surfaceRef: RefObject<HTMLElement | null>;
  insideRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
}

export default function Sidebar({
  collapsed,
  transitioning,
  surfaceRef,
  insideRef,
  onToggle,
}: Props) {
  return (
    <aside ref={surfaceRef} id="app-sidebar" aria-label="Barra lateral" className="relative z-20 h-auto rounded-2xl bg-atlas-mist md:sticky md:top-3 md:h-[calc(100dvh-24px)]">
      <div ref={insideRef} className="flex h-full flex-col gap-2 rounded-[inherit] p-2">
        <Link to="/" aria-label="Atlas, inicio">
          <AtlasBrand />
        </Link>
        <SidebarNavigation collapsed={collapsed} />
        <SidebarAccount collapsed={collapsed} transitioning={transitioning} />
      </div>
      <SidebarToggle collapsed={collapsed} transitioning={transitioning} onToggle={onToggle} />
    </aside>
  );
}
