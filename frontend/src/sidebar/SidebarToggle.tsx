import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

interface Props {
  collapsed: boolean;
  transitioning: boolean;
  onToggle: () => void;
}

export default function SidebarToggle({ collapsed, transitioning, onToggle }: Props) {
  return (
    <div className="group absolute -right-5 top-1/2 hidden h-24 w-10 -translate-y-1/2 items-center justify-center md:flex">
      <button type="button" aria-label={collapsed ? 'Expandir barra lateral' : 'Contraer barra lateral'} aria-expanded={!collapsed} aria-controls="app-sidebar" aria-disabled={transitioning} onClick={onToggle} className="grid h-7 w-7 place-items-center rounded-full border border-atlas-mist bg-white text-atlas-muted opacity-0 shadow-xs transition-[opacity,transform] duration-[160ms] group-hover:opacity-100 group-focus-within:opacity-100 hover:scale-110 hover:text-atlas-red focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-atlas-red motion-reduce:transition-none [@media(hover:none)]:opacity-100">
        {collapsed ? (
          <IconChevronRight size={18} aria-hidden="true" />
        ) : (
          <IconChevronLeft size={18} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
