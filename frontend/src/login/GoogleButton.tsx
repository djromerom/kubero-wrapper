import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from './AuthContext';

interface GoogleIdentity {
  initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
  renderButton(node: HTMLElement, options: { type: string; text: string; theme: string; locale: string }): void;
}
declare global { interface Window { google?: { accounts: { id: GoogleIdentity } } } }

let loading: Promise<GoogleIdentity> | undefined;
function loadGoogle() {
  if (!loading) loading = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => window.google ? resolve(window.google.accounts.id) : reject(new Error('Google no está disponible.'));
    script.onerror = () => { loading = undefined; script.remove(); reject(new Error('No se pudo conectar con Google.')); };
    document.head.appendChild(script);
  });
  return loading;
}

export default function GoogleButton({ link = false }: { link?: boolean }) {
  const node = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const { login } = useAuth();
  const onSession = useRef(login);
  onSession.current = login;
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    async function prepare() {
      const { client_id } = await api.googleConfig();
      if (!active) return;
      if (!client_id) { setUnavailable(true); return; }
      const google = await loadGoogle();
      if (!active || !node.current) return;
      google.initialize({ client_id, callback: async ({ credential }) => {
        if (!active) return;
        try {
          const response = await api.googleSession(credential, link);
          if (!active) return;
          onSession.current(response.token, response.user);
          if (link) setMessage('Cuenta de Google vinculada.');
          else navigate('/', { replace: true });
        } catch (err) { if (active) setMessage((err as Error).message); }
      } });
      google.renderButton(node.current, { type: 'standard', text: link ? 'continue_with' : 'signin_with', theme: 'outline', locale: 'es' });
    }
    prepare().catch(err => { if (active) setMessage(err.message); });
    return () => { active = false; };
  }, [link, navigate]);
  if (unavailable && !link) return <p className="mt-3 text-center text-sm text-atlas-muted">El acceso con Google aún no está configurado.</p>;
  return <><div ref={node} className="my-3 flex justify-center empty:hidden" />{message && <p role="status" className="text-sm">{message}</p>}</>;
}
