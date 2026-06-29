import { useState, type FormEvent } from 'react';
import { supabase, isConfigured } from '../lib/supabase';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-xl border border-edge bg-panel p-6">
        <div className="mb-1 text-xl font-bold text-slate-100">Sentinel</div>
        <div className="mb-6 text-xs text-slate-500">Authorized personnel only · Vision Freights LLC</div>

        {!isConfigured && (
          <div className="mb-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-200">
            Supabase not configured — sign-in is disabled until VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set.
          </div>
        )}

        <label className="mb-1 block text-xs text-slate-400">Email</label>
        <input
          value={email} onChange={(e) => setEmail(e.target.value)} type="email" required
          className="mb-3 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-slate-100"
        />
        <label className="mb-1 block text-xs text-slate-400">Password</label>
        <input
          value={password} onChange={(e) => setPassword(e.target.value)} type="password" required
          className="mb-4 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-slate-100"
        />
        {error && <div className="mb-3 text-xs text-red-400">{error}</div>}
        <button
          type="submit" disabled={busy || !isConfigured}
          className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
