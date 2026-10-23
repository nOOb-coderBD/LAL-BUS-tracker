import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from './types';

let csrfToken = '';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.error?.message || body.message || body.error || `Request failed (${response.status})`,
    );
  return body;
}
export const post = <T,>(path: string, data: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data) });
type AuthData = { user: User | null; csrfToken: string; demoEnabled: boolean };
type AuthContextValue = AuthData & {
  loading: boolean;
  refresh: () => Promise<unknown>;
  loginDemo: (persona: string) => Promise<User | null>;
  logout: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [session, setAuthSession] = useState<AuthData | null>(null);
  const query = useQuery({
    queryKey: ['auth'],
    queryFn: async ({ signal }) => {
      const data = await api<AuthData>('/auth/me', { signal });
      csrfToken = data.csrfToken || '';
      setAuthSession(data);
      return data;
    },
    retry: false,
    staleTime: 60_000,
  });
  const setSession = async (data: AuthData) => {
    await client.cancelQueries();
    csrfToken = data.csrfToken || '';
    client.removeQueries({ predicate: (item) => item.queryKey[0] !== 'auth' });
    client.setQueryData(['auth'], data);
    setAuthSession(data);
  };
  const value = session || query.data;
  return (
    <AuthContext.Provider
      value={{
        user: value?.user || null,
        csrfToken: value?.csrfToken || '',
        demoEnabled: value?.demoEnabled || false,
        loading: query.isPending && !session,
        refresh: query.refetch,
        loginDemo: async (persona) => {
          const data = await post<AuthData>('/auth/dev-login', { persona });
          await setSession(data);
          return data.user;
        },
        logout: async () => {
          const data = await post<AuthData>('/auth/logout');
          await setSession(data);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('AuthProvider missing');
  return auth;
}
export function useConnectivity() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="error-box">
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div role="status" className="loading">
      <div className="skeleton" />
      <div className="skeleton" />
      <span>লোড হচ্ছে · Loading…</span>
    </div>
  );
}
