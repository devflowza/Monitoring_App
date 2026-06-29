import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isConfigured } from './supabase';

export type Role = 'ceo' | 'admin' | 'dept_manager' | 'security_analyst' | 'viewer';

interface AuthState {
  session: Session | null;
  roles: Role[];
  loading: boolean;
  configured: boolean;
  hasRole: (allowed: Role[]) => boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null, roles: [], loading: true, configured: isConfigured,
  hasRole: () => false, signOut: async () => {},
});

async function fetchRoles(): Promise<Role[]> {
  try {
    // app_users → user_roles for the signed-in operator (RLS scopes the read).
    const { data } = await supabase
      .from('user_roles')
      .select('role, app_users!inner(auth_user_id)');
    return ((data ?? []) as Array<{ role: Role }>).map((r) => r.role);
  } catch {
    return [];
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) setRoles(await fetchRoles());
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      setRoles(s ? await fetchRoles() : []);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthState = {
    session, roles, loading, configured: isConfigured,
    hasRole: (allowed) => roles.some((r) => allowed.includes(r)),
    signOut: async () => { await supabase.auth.signOut(); },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
