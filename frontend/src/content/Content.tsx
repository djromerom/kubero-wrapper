import type { RefObject } from 'react';
import { Outlet } from 'react-router-dom';

export default function Content({ contentRef }: { contentRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={contentRef} className="relative z-0 min-w-0">
      <main id="main-content" className="mx-auto max-w-7xl p-6 lg:p-10">
        <Outlet />
      </main>
    </div>
  );
}
