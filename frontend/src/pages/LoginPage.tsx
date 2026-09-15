import AuthLayout from '../components/AuthLayout';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';

export default function LoginPage() {
  const [mode, setMode] = useState<'initial' | 'demo' | 'local'>('initial');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, loginDemo } = useAuth();
  const navigate = useNavigate();

  async function submitLocal(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await api.login({ email, password });
      login(response.token, response.user);
      navigate(response.user.role === 'admin' ? '/admin' : '/', { replace: true });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return <AuthLayout>
    <h2 className="text-2xl font-semibold tracking-tight">Bienvenido a Atlas</h2>
    <p className="mb-8 mt-3 text-sm text-atlas-muted">Un espacio para construir, gestionar y desplegar tus proyectos.</p>

    {mode === 'initial' && <div className="space-y-3">
      <button type="button" onClick={() => setMode('demo')} className="flex w-full items-center justify-center gap-3 rounded-lg bg-atlas-red px-4 py-3 font-medium text-white hover:bg-atlas-ink">
        <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M0 0h9v9H0zM11 0h9v9h-9zM0 11h9v9H0zM11 11h9v9h-9z" /></svg>
        Entrar en demostración
      </button>
      <button type="button" onClick={() => setMode('local')} className="w-full rounded-lg border border-atlas-mist px-4 py-3 font-medium hover:border-atlas-red hover:bg-atlas-mist">Usar backend local</button>
      <p className="pt-3 text-xs leading-relaxed text-atlas-muted">El acceso local permite probar la vinculación real con GitHub. La demostración no solicita credenciales externas.</p>
    </div>}

    {mode === 'demo' && <section aria-labelledby="role-title">
      <h3 id="role-title" className="mb-4 font-semibold">¿Cómo quieres entrar?</h3>
      <div className="space-y-3">
        {(['developer', 'admin'] as const).map(role => <button key={role} type="button" onClick={() => { loginDemo(role); navigate(role === 'admin' ? '/admin' : '/', { replace: true }); }} className="block w-full rounded-lg border border-atlas-mist p-4 text-left hover:border-atlas-red hover:bg-atlas-mist">
          <span className="block font-semibold text-atlas-red">{role === 'admin' ? 'Entrar como administrador' : 'Entrar como desarrollador'}</span>
          <span className="mt-1 block text-sm text-atlas-muted">{role === 'admin' ? 'Consulta los proyectos y el panel de administración.' : 'Accede a tu espacio de proyectos.'}</span>
        </button>)}
      </div>
      <button type="button" onClick={() => setMode('initial')} className="mt-5 text-sm text-atlas-red hover:underline">Volver</button>
    </section>}

    {mode === 'local' && <section aria-labelledby="local-title">
      <h3 id="local-title" className="mb-4 font-semibold">Acceso mediante el backend local</h3>
      <form onSubmit={submitLocal} className="space-y-4">
        <label className="block text-sm">Correo electrónico<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} className="mt-2 w-full rounded-lg bg-atlas-mist px-3 py-2.5"/></label>
        <label className="block text-sm">Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-lg bg-atlas-mist px-3 py-2.5"/></label>
        {error && <p role="alert" className="text-sm text-atlas-red">{error}</p>}
        <button disabled={loading} className="w-full rounded-lg bg-atlas-red px-4 py-3 font-medium text-white hover:bg-atlas-ink disabled:opacity-50">{loading ? 'Iniciando…' : 'Iniciar sesión'}</button>
      </form>
      <p className="mt-4 text-center text-sm text-atlas-muted">¿Primera vez? <Link to="/register" className="text-atlas-red hover:underline">Crear cuenta local</Link></p>
      <button type="button" onClick={() => { setMode('initial'); setError(''); }} className="mt-5 text-sm text-atlas-red hover:underline">Volver</button>
    </section>}
  </AuthLayout>;
}
