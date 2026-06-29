// Service-role Supabase client for edge functions. Bypasses RLS — it is the
// ONLY writer to evt_* tables — so any content fetch it performs MUST be logged
// via the audit helper. Never expose this key to the browser.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/** Read a policy value (the {"value": ...} convention) with a fallback. */
export async function getPolicy<T>(db: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await db.from('policies').select('value_json').eq('policy_key', key).maybeSingle();
  const v = (data?.value_json as { value?: T } | undefined)?.value;
  return v === undefined ? fallback : v;
}
