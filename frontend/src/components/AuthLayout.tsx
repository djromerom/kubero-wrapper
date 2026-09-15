import type { ReactNode } from 'react';
import AtlasBrand from './AtlasBrand';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth-shell">
    <aside className="auth-story">
      <AtlasBrand light />
      <div className="relative z-10 my-16">
        <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em]">Un lugar para tus proyectos</p>
        <h1 className="max-w-lg text-5xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">Tus ideas.<br />Nuestro soporte.</h1>
        <p className="mt-7 max-w-sm text-lg text-white/80">Del primer commit al despliegue. Atlas sostiene los proyectos que construyes.</p>
      </div>
      <p className="relative z-10 text-sm text-white/70">Conocimiento que se convierte en proyectos.</p>
      <div className="atlas-orbit" aria-hidden="true" />
    </aside>
    <section className="flex items-center justify-center px-6 py-12 sm:px-12">
      <div className="w-full max-w-sm">{children}</div>
    </section>
  </main>;
}
