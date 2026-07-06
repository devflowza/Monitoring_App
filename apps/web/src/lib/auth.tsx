import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isConfigured } from './supabase';

export type Role = 'ceo' | 'admin' | 'dept_manager' | 'security_analyst' | 'viewer';

interface AuthState {
  session: Session | null;
  roles: Role[];
  /** The operator's app_users.id (for authoring notes / assignments). */
  appUserId: string | null;
  loading: boolean;
  configured: boolean;
  hasRole: (allowed: Role[]) => boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null, roles: [], appUserId: null, loading: true, configured: isConfigured,
  hasRole: () => false, signOut: async () => {},
});

async function fetchIdentity(authUserId: string): Promise<{ appUserId: string | null; roles: Role[] }> {
  try {
    // app_users self_read + user_roles roles_read RLS scope these to the operator.
    const [{ data: au }, { data: rs }] = await Promise.all([
      supabase.from('app_users').select('id').eq('auth_user_id', authUserId).maybeSingle(),
      supabase.from('user_roles').select('role'),
    ]);
    return {
      appUserId: (au as { id: string } | null)?.id ?? null,
      roles: ((rs ?? []) as Array<{ role: Role }>).map((r) => r.role),
    };
  } catch {
    return { appUserId: null, roles: [] };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [appUserId, setAppUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) {
        const id = await fetchIdentity(data.session.user.id);
        setRoles(id.roles); setAppUserId(id.appUserId);
      }
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      if (s) { const id = await fetchIdentity(s.user.id); setRoles(id.roles); setAppUserId(id.appUserId); }
      else { setRoles([]); setAppUserId(null); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthState = {
    session, roles, appUserId, loading, configured: isConfigured,
    hasRole: (allowed) => roles.some((r) => allowed.includes(r)),
    signOut: async () => { await supabase.auth.signOut(); },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
