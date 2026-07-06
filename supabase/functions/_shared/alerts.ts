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

export async function raiseAlert(db: SupabaseClient, input: RaiseAlertInput): Promise<'ok' | 'error'> {
  // Atomic upsert-or-increment via app_raise_alert — no check-then-insert race,
  // no lost occurrence_count increments (see migration 0005).
  const { error } = await db.rpc('app_raise_alert', {
    p: {
      alert_type: input.alertType,
      severity: input.severity,
      employee_id: input.employeeId ?? null,
      department_id: input.departmentId ?? null,
      source_event_table: input.sourceEventTable ?? null,
      source_event_id: input.sourceEventId ?? null,
      rule_id: input.ruleId ?? null,
      title: input.title,
      summary: input.summary ?? null,
      evidence: input.evidence ?? {},
      dedup_key: input.dedupKey,
    },
  });
  if (error) {
    console.error(`[alerts] raiseAlert failed for ${input.dedupKey}: ${error.message}`);
    return 'error';
  }
  return 'ok';
}
