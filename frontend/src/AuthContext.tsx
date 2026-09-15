import { getDemoUser, startDemo, endDemo, type DemoRole } from './demoSession';
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api, type User } from './api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  loginDemo: (role: DemoRole) => void;
  isAdmin: boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

function storedUser(): User | null {
  const demo = getDemoUser();
  if (demo) return demo;
  const value = localStorage.getItem('user');
  if (!value) return null;
  try { return JSON.parse(value) as User; }
  catch { localStorage.removeItem('user'); return null; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(storedUser);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (getDemoUser()) { setLoading(false); return; }
    if (token) {
      api.health().then(() => setLoading(false)).catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setToken(null);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const loginDemo = (role: DemoRole) => {
    startDemo(role);
    setUser(getDemoUser());
    setLoading(false);
  };

  const logout = () => {
    endDemo();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, loginDemo, logout, isAdmin: user?.role === 'admin', loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
