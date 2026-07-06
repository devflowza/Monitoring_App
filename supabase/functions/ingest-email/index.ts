// ingest-email — pull email deltas from each active gmail source and upsert
// normalized metadata into email_threads / email_events / attachments, plus
// external auto-forwarding rules. Idempotent (upsert on provider ids); advances
// per-source cursors in sync_state. Invoked by pg_cron.
//
// Notice-before-collection: real org-wide (google_admin) sources are skipped
// until policy.monitoring_active is true. Full bodies are only fetched when the
// same flag is set; analyze/ later minimizes non-flagged bodies.

import { adminClient, getPolicy } from '../_shared/db.ts';
import { connectorFactory, type SourceRow } from '../_shared/connectors/factory.ts';
import type { ConnectorContext, NormalizedEmailEvent } from '../_shared/connectors/types.ts';
import { guardRequest } from '../_shared/authz.ts';

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
  unmonitored: Set<string>,
) {
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

  // Per-person kill switch: never store body content for an opted-out employee,
  // even when monitoring is active. Makes the DSAR erasure remedy real.
  const ownerUnmonitored = owner.employeeId ? unmonitored.has(owner.employeeId) : false;
  const hasContent = contentAllowed && rec.body != null && !ownerUnmonitored;
  const { data: ev } = await db.from('email_events').upsert({
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
    // Body is stored inline (MVP; a Storage-encrypted blob is a later hardening)
    // ONLY when permitted. analyze/ minimizes non-flagged bodies afterwards.
    body_ref: hasContent ? rec.body : null,
    content_class: hasContent ? 'content' : 'metadata',
  }, { onConflict: 'provider_message_id' })
    .select('id')
    .single();

  if (ev?.id && (rec.attachments?.length)) {
    await db.from('attachments').upsert(
      rec.attachments.map((a) => ({
        email_event_id: ev.id,
        filename: a.filename ?? null,
        mime_type: a.mimeType ?? null,
        size_bytes: a.sizeBytes ?? null,
        sha256: a.sha256 ?? null,
        is_sensitive_type: a.isSensitiveType ?? false,
      })),
      { onConflict: 'id', ignoreDuplicates: true },
    );
  }
}

Deno.serve(async (req) => {
  const denied = guardRequest(req);
  if (denied) return denied;
  const db = adminClient();
  const internalDomains = await getPolicy<string[]>(db, 'internal_domains', ['visionfreights.com']);
  const personalDomains = await getPolicy<string[]>(db, 'personal_email_domains', []);
  const monitoringActive = await getPolicy<boolean>(db, 'monitoring_active', false);

  const { data: unmon } = await db.from('employees').select('id').eq('is_monitored', false);
  const unmonitored = new Set((unmon ?? []).map((e) => e.id as string));

  const { data: sources } = await db.from('sources').select('*').eq('kind', 'gmail').eq('is_active', true);
  let totalIngested = 0;
  let skipped = 0;

  for (const source of (sources ?? []) as SourceRow[]) {
    // Notice-before-collection: don't collect real employee data pre-go-live.
    if (source.mode === 'google_admin' && !monitoringActive) { skipped++; continue; }

    const ctx: ConnectorContext = {
      sourceId: source.id,
      contentFetchAllowed: monitoringActive,
      internalDomains,
      personalDomains,
    };
    const { data: state } = await db.from('sync_state').select('cursor').eq('source_id', source.id).maybeSingle();
    try {
      const connector = connectorFactory(source, ctx);
      const result = await connector.pullDelta(state?.cursor ?? null, { pageLimit: PAGE_LIMIT });
      for (const rec of result.records) {
        if (rec.kind === 'email_event') {
          await upsertEmailEvent(db, rec, ctx, monitoringActive, unmonitored);
          totalIngested++;
        } else if (rec.kind === 'forwarding_rule') {
          // NB: resolveIdentityId returns a plain object, NOT a Supabase
          // response — destructuring `{ data }` here previously crashed the
          // whole source run the moment any monitored user enabled forwarding.
          const owner = await resolveIdentityId(db, rec.ownerEmail, internalDomains);
          // Upsert (not insert) so repeated detections refresh last_seen_at
          // instead of accumulating duplicate rows every cron tick.
          await db.from('forwarding_rules').upsert({
            identity_id: owner.identityId,
            rule_type: rec.ruleType,
            destination: rec.destination ?? null,
            is_external_destination: rec.isExternalDestination ?? false,
            source_id: source.id,
            last_seen_at: new Date().toISOString(),
          }, { onConflict: 'identity_id,rule_type,destination' });
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

  return Response.json({ ingested: totalIngested, skipped, sources: sources?.length ?? 0 });
});
