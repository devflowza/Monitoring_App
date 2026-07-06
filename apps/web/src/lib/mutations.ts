import { supabase } from './supabase';
import type { AlertStatus, RevealedContent } from './types';

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

/** Toggle a source on/off (RLS: ceo/admin). */
export async function setSourceActive(id: string, isActive: boolean): Promise<MutationResult> {
  return runUpdate(supabase.from('sources').update({ is_active: isActive }).eq('id', id).select('id'));
}

/** Request on-demand report generation (role-gated definer that invokes the edge fn). */
export async function requestReport(type: string): Promise<MutationResult> {
  try {
    const { error } = await supabase.rpc('app_request_report', { p_type: type });
    return { error: error ? error.message : null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Assign / unassign an alert to an operator (RLS: ceo/admin/analyst). */
export async function assignAlert(alertId: string, appUserId: string | null): Promise<MutationResult> {
  return runUpdate(supabase.from('alerts').update({ assigned_to: appUserId }).eq('id', alertId).select('id'));
}

/** Add an investigation note. The author must be the current operator (RLS-checked). */
export async function addAlertNote(alertId: string, authorAppUserId: string, note: string): Promise<MutationResult> {
  try {
    const { error } = await supabase.from('alert_notes').insert({ alert_id: alertId, author_app_user_id: authorAppUserId, note });
    return { error: error ? error.message : null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Reveal a flagged email's content through the audited SECURITY DEFINER RPC.
 * The RPC writes a view_content audit_log row (justification required) before
 * returning the body, so every human content view is accountable.
 */
export async function revealContent(
  eventId: string, justification: string,
): Promise<{ data: RevealedContent | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('app_reveal_content', {
      p_event_id: eventId, p_justification: justification,
    });
    if (error) return { data: null, error: error.message };
    const row = Array.isArray(data) ? data[0] : data;
    return { data: (row ?? null) as RevealedContent | null, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
