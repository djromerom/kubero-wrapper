import type { ReactNode } from 'react';
import AtlasBrand from '../shared/AtlasBrand';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-end justify-start bg-atlas-ink p-4">
      <section className="w-full max-w-[400px] rounded-3xl border border-white/[.15] bg-white p-4 shadow-[0_20px_65px_#00000030]">
        <div className="mb-4 flex justify-start">
          <AtlasBrand />
        </div>
        {children}
      </section>
    </main>
  );
}
