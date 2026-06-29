import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True when real Supabase credentials are present; the UI degrades gracefully
 *  to empty states when not (so the dashboard runs before the backend is wired). */
export const isConfigured = Boolean(url && anon);

export const supabase = createClient(
  url ?? 'http://localhost:54321',
  anon ?? 'public-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true } },
);
