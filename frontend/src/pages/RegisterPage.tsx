import AuthLayout from '../components/AuthLayout';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.register({ name, email, password });
      login(res.token, res.user);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <AuthLayout>
      <div>
        <h1 className="text-2xl font-bold text-atlas-red mb-6 text-center">Crea tu cuenta de Atlas</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-atlas-muted mb-1" htmlFor="name">Nombre</label>
            <input
              id="name" autoComplete="name" value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-atlas-mist rounded px-3 py-2 text-atlas-ink"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-atlas-muted mb-1" htmlFor="email">Correo electrónico</label>
            <input
              id="email" autoComplete="email" type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-atlas-mist rounded px-3 py-2 text-atlas-ink"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-atlas-muted mb-1" htmlFor="password">Contraseña</label>
            <input
              id="password" autoComplete="new-password" type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-atlas-mist rounded px-3 py-2 text-atlas-ink"
              required
              minLength={6}
            />
          </div>
          {error && <p className="text-atlas-red text-sm">{error}</p>}
          <button type="submit" className="w-full bg-atlas-red text-white py-2 rounded hover:bg-atlas-ink">
            Registrarse
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-atlas-muted">
          ¿Ya tienes cuenta? <Link to="/login" className="text-atlas-red hover:underline">Iniciar sesión</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
