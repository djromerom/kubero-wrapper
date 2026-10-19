import Sidebar from './sidebar/Sidebar';
import { useSidebarTransition } from './sidebar/useSidebarTransition';
import Content from './content/Content';

export default function Layout() {
  const { compact, collapsed, transitioning, surfaceRef, insideRef, contentRef, toggleSidebar } =
    useSidebarTransition();

  return (
    <div className={`min-h-screen overflow-x-clip bg-white p-3 md:grid ${compact ? 'md:grid-cols-[64px_minmax(0,1fr)]' : 'md:grid-cols-[264px_minmax(0,1fr)]'}`}>
      <Sidebar collapsed={collapsed} transitioning={transitioning} surfaceRef={surfaceRef} insideRef={insideRef} onToggle={() => void toggleSidebar()} />
      <Content contentRef={contentRef} />
    </div>
  );
}
