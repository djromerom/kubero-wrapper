import { useEffect, useState } from 'react';
import { api, type User } from '../api';
import GithubButton from '../shared/GithubButton';
import {
  IconFileText,
  IconLogout,
  IconUser,
} from '@tabler/icons-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../login/AuthContext';

export default function ProfilePanel({
  user,
  onClose,
}: {
  user: User | null;
  onClose: () => void;
}) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [linked, setLinked] = useState<boolean | null>(null);
  const [githubLogin, setGithubLogin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    window.localStorage.setItem('atlas.appearance', 'light');
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .githubStatus()
      .then((status) => {
        setLinked(status.linked);
        setGithubLogin(status.login || '');
      })
      .catch((cause) => setError((cause as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function connectGithub() {
    setError('');
    setLoading(true);
    try {
      await api.githubConnect();
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
      await api.githubDisconnect();
      setLinked(false);
      setGithubLogin('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const signOut = () => {
    logout();
    navigate('/login');
  };

  return (
    <section className="flex flex-col items-center gap-2">
      <div className="flex w-full items-center gap-3 text-left mb-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-atlas-mist text-atlas-ink" aria-hidden="true">
          <IconUser size={20} stroke={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold" title={user?.name}>
            {user?.name}
          </h3>
          <p className="truncate text-xs text-atlas-muted" title={user?.email}>
            {user?.email || 'Correo no disponible'}
          </p>
        </div>
      </div>
      <div className="grid w-full grid-cols-3 gap-2">
        <div className="min-w-0 col-span-2">
          <GithubButton linked={linked === true} login={githubLogin} disabled={loading || linked === null} onClick={linked ? disconnectGithub : connectGithub} />
        </div>
        <Link to="/docs" onClick={onClose} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-atlas-red p-2 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-atlas-red">
          <IconFileText size={18} stroke={1.8} aria-hidden="true" className="shrink-0" />
          Docs
        </Link>
      </div>
      {error && (
        <p className="mt-3 text-xs text-atlas-red" role="alert">
          {error}
        </p>
      )}
      {/*<div className="mt-5 grid w-full grid-cols-3 gap-1" role="group" aria-label="Apariencia">
        <button type="button" aria-pressed="true" className="flex flex-col items-center gap-1 rounded-lg border border-atlas-ink bg-atlas-ink px-1 py-2 text-[11px] font-medium text-white">
          <IconSunHigh size={20} stroke={2} aria-hidden="true" />
        </button>
        <button type="button" disabled title="Próximamente" className="flex flex-col items-center gap-1 rounded-lg border border-atlas-mist px-1 py-2 text-[11px] font-medium text-atlas-muted opacity-50">
          <IconMoon size={20} stroke={2} aria-hidden="true" />
        </button>
        <button type="button" disabled title="Próximamente" className="flex flex-col items-center gap-1 rounded-lg border border-atlas-mist px-1 py-2 text-[11px] font-medium text-atlas-muted opacity-50">
          <IconDeviceDesktop size={20} stroke={2} aria-hidden="true" />
        </button>
      </div>*/}
      <button type="button" onClick={signOut} className="flex w-full items-center justify-center gap-2 rounded-xl border border-black/15 px-3 py-3 text-sm font-semibold hover:bg-atlas-mist">
        <IconLogout size={20} stroke={1.8} aria-hidden="true" />
        Cerrar sesión
      </button>
    </section>
  );
}
