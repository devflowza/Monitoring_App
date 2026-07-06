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

/** Summary a wrapped run reports back for the job_runs ledger. */
export interface RunSummary {
  recordsProcessed?: number;
  alertsRaised?: number;
  detail?: Record<string, unknown>;
}

/**
 * Wrap an edge-function's work so every invocation is recorded in job_runs with
 * timing, counts, and any error — turning the previously fire-and-forget cron
 * pipeline into something an operator can actually see the health of. Errors are
 * recorded and re-thrown so the function still returns a 500.
 */
export async function withRun<T extends RunSummary>(
  db: SupabaseClient,
  functionName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const { data: run } = await db.from('job_runs')
    .insert({ function_name: functionName, status: 'running' })
    .select('id')
    .single();
  const runId = run?.id ?? null;
  try {
    const result = await fn();
    if (runId) {
      await db.from('job_runs').update({
        finished_at: new Date().toISOString(),
        status: 'ok',
        records_processed: result.recordsProcessed ?? null,
        alerts_raised: result.alertsRaised ?? null,
        detail: result.detail ?? {},
      }).eq('id', runId);
    }
    return result;
  } catch (e) {
    console.error(`[${functionName}] run failed: ${String(e)}`);
    if (runId) {
      await db.from('job_runs').update({
        finished_at: new Date().toISOString(),
        status: 'error',
        error_detail: String(e),
      }).eq('id', runId);
    }
    throw e;
  }
}
