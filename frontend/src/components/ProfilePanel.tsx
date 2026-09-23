import { useEffect, useState } from 'react';
import { api, type User } from '../api';
import { getDemoUser, isDemoGithubLinked, linkDemoGithub, unlinkDemoGithub } from '../demoSession';
import GithubButton from './GithubButton';
import { IconDeviceDesktop, IconLogout, IconMoon, IconSunHigh, IconUser } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

export default function ProfilePanel({ user }: { user: User | null }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [linked, setLinked] = useState<boolean | null>(null);
  const [githubLogin, setGithubLogin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const demo = Boolean(getDemoUser());

  useEffect(() => {
    window.localStorage.setItem('atlas.appearance', 'light');
  }, []);

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

  return <section className='flex flex-col items-center'>
    <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-atlas-mist text-atlas-ink" aria-hidden="true">
      <IconUser size={28} stroke={1.8} />
    </div>
    <h3 className="line-clamp-1 text-base font-semibold">{user?.name}</h3>
    <p className="line-clamp-1 text-xs text-atlas-muted">{user?.email || (demo ? 'usuario@atlas.example' : 'Correo no disponible')}</p>
    <div className="mt-6"><GithubButton linked={linked === true} login={githubLogin} disabled={loading || linked === null} onClick={linked ? disconnectGithub : connectGithub} /></div>
    {error && <p className="mt-3 text-xs text-atlas-red" role="alert">{error}</p>}
    <div className="mt-5 grid w-full grid-cols-3 gap-1" role="group" aria-label="Apariencia">
      <button type="button" aria-pressed="true" className="flex flex-col items-center gap-1 rounded-lg border border-atlas-ink bg-atlas-ink px-1 py-2 text-[11px] font-medium text-white"><IconSunHigh size={20} stroke={2} aria-hidden="true" /></button>
      <button type="button" disabled title="Próximamente" className="flex flex-col items-center gap-1 rounded-lg border border-atlas-mist px-1 py-2 text-[11px] font-medium text-atlas-muted opacity-50"><IconMoon size={20} stroke={2} aria-hidden="true" /></button>
      <button type="button" disabled title="Próximamente" className="flex flex-col items-center gap-1 rounded-lg border border-atlas-mist px-1 py-2 text-[11px] font-medium text-atlas-muted opacity-50"><IconDeviceDesktop size={20} stroke={2} aria-hidden="true" /></button>
    </div>
    <button type="button" onClick={() => { logout(); navigate('/login'); }} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-black/15 px-3 py-3 text-sm font-semibold hover:bg-atlas-mist"><IconLogout size={20} stroke={1.8} aria-hidden="true" />Cerrar sesión</button>
  </section>;
}
