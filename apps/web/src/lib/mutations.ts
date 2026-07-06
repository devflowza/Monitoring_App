import { supabase } from './supabase';
import type { AlertStatus } from './types';

export interface MutationResult { error: string | null }

/**
 * Run an UPDATE and report failure honestly. We append `.select()` so we can
 * detect the silent case where RLS filters the row out: PostgREST returns
 * `error: null` with zero affected rows, which previously looked like success
 * and then "reverted" on reload.
 */
async function runUpdate(
  query: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<MutationResult> {
  try {
    const { data, error } = await query;
    if (error) return { error: error.message };
    if (Array.isArray(data) && data.length === 0) {
      return { error: 'No rows were updated — you may not have permission (RLS).' };
    }
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Update an alert's triage status. RLS restricts this to ceo/admin/analyst. */
export async function setAlertStatus(id: string, status: AlertStatus): Promise<MutationResult> {
  return runUpdate(supabase.from('alerts').update({ status }).eq('id', id).select('id'));
}

/** Flip a policy flag (the {"value": ...} convention). */
export async function setPolicyValue(key: string, value: unknown): Promise<MutationResult> {
  return runUpdate(supabase.from('policies').update({ value_json: { value } }).eq('policy_key', key).select('policy_key'));
}

export async function setDlpRuleActive(id: string, isActive: boolean): Promise<MutationResult> {
  return runUpdate(supabase.from('dlp_rules').update({ is_active: isActive }).eq('id', id).select('id'));
}

export async function setRiskWeight(id: string, weight: number): Promise<MutationResult> {
  return runUpdate(supabase.from('risk_weights').update({ weight }).eq('id', id).select('id'));
}

export async function setSlaThreshold(id: string, thresholdMinutes: number): Promise<MutationResult> {
  return runUpdate(supabase.from('sla_rules').update({ threshold_minutes: thresholdMinutes }).eq('id', id).select('id'));
}
