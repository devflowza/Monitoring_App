// Audit-of-auditors helper. Any edge-function action that fetches or stores raw
// message CONTENT must call logContentFetch() — this is the machine-side
// counterpart to the human-side audit_log writes the dashboard performs on
// content views. audit_log is append-only (DB trigger blocks UPDATE/DELETE).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function logContentFetch(db: SupabaseClient, opts: {
  targetTable: string;
  targetId: string;
  reason: string;            // e.g. dlp rule id / alert id that justified the fetch
}): Promise<void> {
  await db.from('audit_log').insert({
    actor_app_user_id: null,        // null = system/edge-function actor
    action: 'view_content',
    target_table: opts.targetTable,
    target_id: opts.targetId,
    accessed_content_class: 'content',
    justification: `edge-function content fetch: ${opts.reason}`,
  });
}

export async function logSystemAction(db: SupabaseClient, opts: {
  action: 'change_policy' | 'run_query' | 'view_metadata';
  targetTable?: string;
  targetId?: string;
  justification?: string;
}): Promise<void> {
  await db.from('audit_log').insert({
    actor_app_user_id: null,
    action: opts.action,
    target_table: opts.targetTable ?? null,
    target_id: opts.targetId ?? null,
    justification: opts.justification ?? null,
  });
}
