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
          <label className="atlas-field">
            <span className="atlas-field-label">Nombre</span>
            <input
              id="name" autoComplete="name" value={name}
              onChange={e => setName(e.target.value)}
              className="atlas-control"
              required
            />
          </label>
          <label className="atlas-field">
            <span className="atlas-field-label">Correo electrónico</span>
            <input
              id="email" autoComplete="email" type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="atlas-control"
              required
            />
          </label>
          <label className="atlas-field">
            <span className="atlas-field-label">Contraseña</span>
            <input
              id="password" autoComplete="new-password" type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="atlas-control"
              required
              minLength={6}
            />
          </label>
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
