import { supabase } from './supabase';
import type { AlertStatus } from './types';

/** Update an alert's triage status. RLS restricts this to ceo/admin/analyst. */
export async function setAlertStatus(id: string, status: AlertStatus): Promise<void> {
  await supabase.from('alerts').update({ status }).eq('id', id);
}

/** Flip a policy flag (the {"value": ...} convention). */
export async function setPolicyValue(key: string, value: unknown): Promise<void> {
  await supabase.from('policies').update({ value_json: { value } }).eq('policy_key', key);
}

export async function setDlpRuleActive(id: string, isActive: boolean): Promise<void> {
  await supabase.from('dlp_rules').update({ is_active: isActive }).eq('id', id);
}

export async function setRiskWeight(id: string, weight: number): Promise<void> {
  await supabase.from('risk_weights').update({ weight }).eq('id', id);
}

export async function setSlaThreshold(id: string, thresholdMinutes: number): Promise<void> {
  await supabase.from('sla_rules').update({ threshold_minutes: thresholdMinutes }).eq('id', id);
}
