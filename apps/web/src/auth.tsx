import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';

interface User {
  id: string;
  email: string;
  firstName: string;
  role: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = 'orderflow.auth';

function loadStored(): { user: User; accessToken: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { user: User; accessToken: string };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = loadStored();
  const [user, setUser] = useState<User | null>(stored?.user ?? null);
  const [accessToken, setAccessToken] = useState<string | null>(
    stored?.accessToken ?? null,
  );

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    const next = {
      user: res.data.user,
      accessToken: res.data.accessToken,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setUser(next.user);
    setAccessToken(next.accessToken);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
    setAccessToken(null);
  }, []);

  const value = useMemo(
    () => ({ user, accessToken, login, logout }),
    [user, accessToken, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
