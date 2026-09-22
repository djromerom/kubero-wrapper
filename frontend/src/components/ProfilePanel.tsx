import { useEffect, useState } from 'react';
import { api, type User } from '../api';
import { getDemoUser, isDemoGithubLinked, linkDemoGithub, unlinkDemoGithub } from '../demoSession';

export default function ProfilePanel({ user }: { user: User | null }) {
  const [settings, setSettings] = useState(false);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [githubLogin, setGithubLogin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const demo = Boolean(getDemoUser());

  useEffect(() => {
    if (demo) {
      const demoLinked = isDemoGithubLinked();
      setLinked(demoLinked);
      setGithubLogin(demoLinked ? 'atlas-demo' : '');
      return;
    }
    setLoading(true);
    api.githubStatus()
      .then(status => {
        setLinked(status.linked);
        setGithubLogin(status.login || '');
      })
      .catch(cause => setError((cause as Error).message))
      .finally(() => setLoading(false));
  }, [demo]);

  async function connectGithub() {
    setError('');
    setLoading(true);
    try {
      if (demo) {
        linkDemoGithub();
        setLinked(true);
        setGithubLogin('atlas-demo');
      } else {
        await api.githubConnect();
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function disconnectGithub() {
    if (!window.confirm('¿Quieres desvincular tu cuenta de GitHub de Atlas?')) return;
    setError('');
    setLoading(true);
    try {
      if (demo) unlinkDemoGithub();
      else await api.githubDisconnect();
      setLinked(false);
      setGithubLogin('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return <>
    <div className="mb-4 mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-atlas-mist text-atlas-ink" aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="7" r="4"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/></svg>
    </div>
    <h3 className="break-words text-base font-semibold">{user?.name}</h3>
    <p className="mt-1 break-all text-xs text-atlas-muted">{user?.email || (demo ? 'usuario@atlas.example' : 'Correo no disponible')}</p>
    <dl className="mt-6 text-xs">
      <div className="border-b border-atlas-mist py-3"><dt className="text-atlas-muted">Rol</dt><dd className="mt-1 font-semibold">{user?.role === 'admin' ? 'Administrador' : 'Desarrollador'}</dd></div>
      <div className="border-b border-atlas-mist py-3"><dt className="text-atlas-muted">Institución</dt><dd className="mt-1 font-semibold">Universidad del Norte</dd></div>
    </dl>
    <div className="mt-5 flex flex-wrap items-center gap-2" aria-label="Vínculo de GitHub">
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-label="GitHub" role="img"><path d="M9 19c-4.3 1.3-4.3-2.2-6-2.7M15 22v-3.8c0-1.1-.4-1.9-1-2.4 3.3-.4 6.7-1.6 6.7-7A5.4 5.4 0 0 0 19.2 5c.2-.8.2-2.1-.2-3 0 0-1.2-.4-4 1.5a14 14 0 0 0-6 0C6.2 1.6 5 2 5 2c-.4.9-.4 2.2-.2 3a5.4 5.4 0 0 0-1.5 3.8c0 5.4 3.4 6.6 6.7 7-.6.5-1 1.3-1 2.4V22"/></svg>
      <span className="min-w-0 break-all text-xs font-medium">{loading || linked === null ? 'Comprobando…' : linked ? `@${githubLogin}` : 'Sin vincular'}</span>
      {linked && <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-[10px] font-medium text-green-800"><span className="h-1.5 w-1.5 rounded-full bg-green-700" aria-hidden="true"/>Vinculado</span>}
    </div>
    {demo && linked && <p className="mt-2 text-[10px] text-atlas-muted">Vínculo simulado de demostración.</p>}
    {linked === false && <>
      <p className="mt-3 text-xs leading-relaxed text-atlas-muted">Vincula tu cuenta para seleccionar repositorios y ramas autorizados.</p>
      <button type="button" onClick={connectGithub} disabled={loading} className="mt-3 w-full rounded-lg bg-atlas-ink px-3 py-3 text-sm font-semibold text-white hover:bg-atlas-red disabled:opacity-50">{loading ? 'Conectando…' : demo ? 'Vincular GitHub (demo)' : 'Vincular GitHub'}</button>
    </>}
    {linked && <>
      <p className="mt-3 rounded-lg bg-atlas-mist p-3 text-xs leading-relaxed text-atlas-muted">La integración puede leer únicamente los repositorios autorizados para esta cuenta.</p>
      <button type="button" onClick={disconnectGithub} disabled={loading} className="mt-3 w-full rounded-lg border border-atlas-red px-3 py-3 text-sm font-semibold text-atlas-red hover:bg-atlas-red hover:text-white disabled:opacity-50">{loading ? 'Desvinculando…' : 'Desvincular GitHub'}</button>
    </>}
    {error && <p className="mt-3 text-xs text-atlas-red" role="alert">{error}</p>}
    <button type="button" aria-expanded={settings} aria-controls="profile-settings" onClick={() => setSettings(!settings)} className="mt-4 w-full rounded-lg bg-atlas-red px-3 py-3 text-sm font-semibold text-white hover:bg-atlas-ink">Más ajustes</button>
    {settings && <section id="profile-settings" aria-label="Más ajustes" className="mt-4 border-t border-atlas-mist pt-4"><h4 className="text-sm font-semibold">Ajustes de la cuenta</h4><p className="mt-2 text-xs leading-relaxed text-atlas-muted">Los ajustes de cuenta y preferencias estarán disponibles cuando se conecten los servicios institucionales.</p></section>}
  </>;
}
