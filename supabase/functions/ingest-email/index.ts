// ingest-email — pull email deltas from each active gmail source and upsert
// normalized metadata into email_threads / email_events. Idempotent (upsert on
// provider ids); advances per-source cursors in sync_state. Invoked by pg_cron.
//
// Full message bodies are fetched ONLY when policy.monitoring_active is true
// (the notice/DPIA go-live gate) — until then this runs metadata-first.

import { adminClient, getPolicy } from '../_shared/db.ts';
import { connectorFactory, type SourceRow } from '../_shared/connectors/factory.ts';
import type { ConnectorContext, NormalizedEmailEvent } from '../_shared/connectors/types.ts';

const PAGE_LIMIT = 100;

async function resolveIdentityId(
  db: ReturnType<typeof adminClient>,
  email: string | null | undefined,
  internalDomains: string[],
): Promise<{ identityId: string | null; employeeId: string | null; departmentId: string | null }> {
  if (!email) return { identityId: null, employeeId: null, departmentId: null };
  const value = email.toLowerCase();
  const isInternal = internalDomains.includes(value.split('@')[1] ?? '');
  const employee = isInternal
    ? (await db.from('employees').select('id, department_id').eq('primary_email', value).maybeSingle()).data
    : null;
  const { data: identity } = await db.from('identities')
    .upsert(
      { identity_type: 'email', value, is_internal: isInternal, employee_id: employee?.id ?? null },
      { onConflict: 'identity_type,value' },
    )
    .select('id')
    .single();
  return {
    identityId: identity?.id ?? null,
    employeeId: employee?.id ?? null,
    departmentId: employee?.department_id ?? null,
  };
}

async function upsertEmailEvent(
  db: ReturnType<typeof adminClient>,
  rec: NormalizedEmailEvent,
  ctx: ConnectorContext,
  contentAllowed: boolean,
) {
  // Thread first (FK target).
  const { data: thread } = await db.from('email_threads')
    .upsert({
      provider_thread_id: rec.providerThreadId,
      subject: rec.subject ?? null,
      last_message_at: rec.sentAt ?? null,
    }, { onConflict: 'provider_thread_id' })
    .select('id')
    .single();

  const from = await resolveIdentityId(db, rec.fromEmail, ctx.internalDomains);
  const tos = await Promise.all((rec.toEmails ?? []).map((e) => resolveIdentityId(db, e, ctx.internalDomains)));
  const owner = rec.direction === 'inbound'
    ? tos.find((t) => t.employeeId) ?? { employeeId: null, departmentId: null }
    : { employeeId: from.employeeId, departmentId: from.departmentId };

  const hasContent = contentAllowed && rec.body != null;
  await db.from('email_events').upsert({
    thread_id: thread?.id ?? null,
    provider_message_id: rec.providerMessageId,
    direction: rec.direction,
    from_identity_id: from.identityId,
    to_identity_ids: tos.map((t) => t.identityId).filter(Boolean),
    owner_employee_id: owner.employeeId,
    owner_department_id: owner.departmentId,
    sent_at: rec.sentAt ?? null,
    has_attachments: rec.hasAttachments ?? false,
    external_recipient_count: (rec.toEmails ?? []).filter(
      (e) => !ctx.internalDomains.includes((e.split('@')[1] ?? '')),
    ).length,
    is_personal_account_contact: (rec.toEmails ?? []).some(
      (e) => ctx.personalDomains.includes((e.split('@')[1] ?? '')),
    ),
    subject: rec.subject ?? null,
    snippet: rec.snippet ?? null,
    // content stored only when permitted; otherwise metadata-only
    content_class: hasContent ? 'content' : 'metadata',
    body_ref: null,            // body persisted by analyze/ only on a policy match
  }, { onConflict: 'provider_message_id' });
}

Deno.serve(async () => {
  const db = adminClient();
  const internalDomains = await getPolicy<string[]>(db, 'internal_domains', ['visionfreights.com']);
  const personalDomains = await getPolicy<string[]>(db, 'personal_email_domains', []);
  const contentAllowed = await getPolicy<boolean>(db, 'monitoring_active', false);

  const { data: sources } = await db.from('sources').select('*').eq('kind', 'gmail').eq('is_active', true);
  let totalIngested = 0;

  for (const source of (sources ?? []) as SourceRow[]) {
    const ctx: ConnectorContext = {
      sourceId: source.id,
      contentFetchAllowed: contentAllowed,
      internalDomains,
      personalDomains,
    };
    const { data: state } = await db.from('sync_state').select('cursor').eq('source_id', source.id).maybeSingle();
    try {
      const connector = connectorFactory(source, ctx);
      const result = await connector.pullDelta(state?.cursor ?? null, { pageLimit: PAGE_LIMIT });
      for (const rec of result.records) {
        if (rec.kind === 'email_event') {
          await upsertEmailEvent(db, rec, ctx, contentAllowed);
          totalIngested++;
        }
      }
      await db.from('sync_state').upsert({
        source_id: source.id, cursor: result.nextCursor,
        last_run_at: new Date().toISOString(), last_status: 'ok', error_detail: null,
      }, { onConflict: 'source_id' });
    } catch (e) {
      await db.from('sync_state').upsert({
        source_id: source.id, last_run_at: new Date().toISOString(),
        last_status: 'error', error_detail: String(e),
      }, { onConflict: 'source_id' });
    }
  }

  return Response.json({ ingested: totalIngested, sources: sources?.length ?? 0 });
});
