// Single entry point for raising alerts. Computes/uses a dedup_key so repeated
// detections increment occurrence_count instead of spamming new rows. The alerts
// table is realtime-published, so an insert here surfaces live in the dashboard.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface RaiseAlertInput {
  alertType: string;
  severity: Severity;
  title: string;
  summary?: string;
  employeeId?: string | null;
  departmentId?: string | null;
  sourceEventTable?: string;
  sourceEventId?: string;
  ruleId?: string | null;
  /** Metadata pointers ONLY — never raw flagged content. */
  evidence?: Record<string, unknown>;
  dedupKey: string;
}

export async function raiseAlert(db: SupabaseClient, input: RaiseAlertInput): Promise<'created' | 'deduped'> {
  const now = new Date().toISOString();
  const { data: existing } = await db
    .from('alerts')
    .select('id, occurrence_count')
    .eq('dedup_key', input.dedupKey)
    .maybeSingle();

  if (existing) {
    await db.from('alerts')
      .update({ occurrence_count: (existing.occurrence_count ?? 1) + 1, last_seen_at: now })
      .eq('id', existing.id);
    return 'deduped';
  }

  await db.from('alerts').insert({
    alert_type: input.alertType,
    severity: input.severity,
    status: 'open',
    employee_id: input.employeeId ?? null,
    department_id: input.departmentId ?? null,
    source_event_table: input.sourceEventTable ?? null,
    source_event_id: input.sourceEventId ?? null,
    rule_id: input.ruleId ?? null,
    title: input.title,
    summary: input.summary ?? null,
    evidence_json: input.evidence ?? {},
    dedup_key: input.dedupKey,
    first_seen_at: now,
    last_seen_at: now,
  });
  return 'created';
}
