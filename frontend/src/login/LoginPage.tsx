import { fieldClassName, fieldLabelClassName, controlClassName } from '../shared/formStyles';
import AuthLayout from './AuthLayout';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from './AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function submitLocal(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    const form = event.currentTarget as HTMLFormElement;
    if (!form.checkValidity()) {
      setError(
        !email.trim() || !password
          ? 'Ingresa tu correo institucional y tu contraseña.'
          : 'Ingresa un correo institucional válido.'
      );
      form.querySelector<HTMLInputElement>('input:invalid')?.focus();
      return;
    }
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

  return (
    <AuthLayout>
      <h1 className="mb-8 text-left text-2xl font-semibold tracking-tight">Bienvenido/a a Atlas</h1>
      <form onSubmit={submitLocal} noValidate aria-busy={loading} className="space-y-6">
        <label className={fieldClassName}>
          <span className={fieldLabelClassName}>Correo Institucional</span>
          <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} className={controlClassName} />
        </label>
        <label className={fieldClassName}>
          <span className={fieldLabelClassName}>Contraseña</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className={controlClassName} />
        </label>
        <div className="flex items-center py-3 text-sm leading-5" aria-live="polite" aria-atomic="true">
          {(error || loading) && (
            <p key={error || 'loading'} className={`animate-message-fade motion-reduce:animate-none ${error ? 'text-atlas-red' : 'text-atlas-muted'}`}>
              {error || 'Comprobando tus credenciales…'}
            </p>
          )}
        </div>
        <button disabled={loading} className="w-full rounded-lg bg-atlas-red px-4 py-3 font-medium text-white hover:bg-atlas-ink disabled:opacity-50">
          {loading ? 'Iniciando…' : 'Iniciar sesión'}
        </button>
      </form>
      <Link to="/register" className="mt-5 block text-center text-sm font-medium text-atlas-red hover:underline">
        Crear cuenta
      </Link>
    </AuthLayout>
  );
}
