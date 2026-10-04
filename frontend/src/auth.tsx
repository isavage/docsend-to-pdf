import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';

export type Tier = 'free' | 'member';

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
}

export interface AuthConfig {
  googleEnabled: boolean;
  emailVerificationRequired: boolean;
  memberTierMaxSlides: number;
  freeTierMaxSlides: number;
}

interface AuthState {
  user: AuthUser | null;
  tier: Tier;
  config: AuthConfig;
  loading: boolean;
  signup: (email: string, password: string, name?: string) => Promise<string | null>;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  resendVerification: () => Promise<string | null>;
  refresh: () => Promise<void>;
}

const defaultConfig: AuthConfig = {
  googleEnabled: false,
  emailVerificationRequired: false,
  memberTierMaxSlides: 1000,
  freeTierMaxSlides: 10,
};

const AuthContext = createContext<AuthState | null>(null);

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/auth${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export function useAuthProvider(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tier, setTier] = useState<Tier>('free');
  const [config, setConfig] = useState<AuthConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ user: AuthUser | null; tier: Tier }>('/me');
      setUser(me.user);
      setTier(me.tier);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api<AuthConfig>('/config').then(setConfig).catch(() => {});
    refresh();
  }, [refresh]);

  const signup = useCallback(
    async (email: string, password: string, name?: string) => {
      try {
        const r = await api<{ user: AuthUser; tier: Tier }>('/signup', {
          method: 'POST',
          body: JSON.stringify({ email, password, name: name || undefined }),
        });
        setUser(r.user);
        setTier(r.tier);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    },
    []
  );

  const login = useCallback(async (email: string, password: string) => {
    try {
      const r = await api<{ user: AuthUser; tier: Tier }>('/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setUser(r.user);
      setTier(r.tier);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, []);

  const logout = useCallback(async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setTier('free');
  }, []);

  const resendVerification = useCallback(async () => {
    try {
      await api('/resend-verification', { method: 'POST' });
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, []);

  return { user, tier, config, loading, signup, login, logout, resendVerification, refresh };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useAuthProvider();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within the auth provider');
  return ctx;
}
