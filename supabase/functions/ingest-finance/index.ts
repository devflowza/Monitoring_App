// ingest-finance — pull PayPal invoices/transactions → finance_events, then
// detect overdue invoices / pending payment follow-ups. Invoked by pg_cron.

import { adminClient, getPolicy } from '../_shared/db.ts';
import { connectorFactory, type SourceRow } from '../_shared/connectors/factory.ts';
import type { ConnectorContext } from '../_shared/connectors/types.ts';
import { raiseAlert } from '../_shared/alerts.ts';

Deno.serve(async () => {
  const db = adminClient();
  const internalDomains = await getPolicy<string[]>(db, 'internal_domains', ['visionfreights.com']);
  const { data: sources } = await db.from('sources').select('*').eq('kind', 'paypal').eq('is_active', true);
  let ingested = 0;

  for (const source of (sources ?? []) as SourceRow[]) {
    const ctx: ConnectorContext = { sourceId: source.id, contentFetchAllowed: false, internalDomains, personalDomains: [] };
    try {
      const connector = connectorFactory(source, ctx);
      const result = await connector.pullDelta(null, { pageLimit: 100 });
      for (const rec of result.records) {
        if (rec.kind !== 'finance_event') continue;
        await db.from('finance_events').upsert({
          source_id: source.id,
          provider_object_id: rec.providerObjectId,
          object_type: rec.objectType,
          status: rec.status ?? null,
          counterparty: rec.counterparty ?? null,
          amount: rec.amount ?? null,
          currency: rec.currency ?? null,
          issued_at: rec.issuedAt ?? null,
          due_at: rec.dueAt ?? null,
          paid_at: rec.paidAt ?? null,
        }, { onConflict: 'object_type,provider_object_id' });
        ingested++;
      }
      await db.from('sync_state').upsert(
        { source_id: source.id, last_run_at: new Date().toISOString(), last_status: 'ok' },
        { onConflict: 'source_id' },
      );
    } catch (e) {
      await db.from('sync_state').upsert(
        { source_id: source.id, last_run_at: new Date().toISOString(), last_status: 'error', error_detail: String(e) },
        { onConflict: 'source_id' },
      );
    }
  }

  // Detection: overdue, unpaid invoices → pending-payment follow-up.
  const { data: overdue } = await db.from('finance_events')
    .select('id, provider_object_id, counterparty, due_at, amount, currency, status')
    .eq('object_type', 'invoice').is('paid_at', null)
    .not('due_at', 'is', null).lt('due_at', new Date().toISOString()).limit(500);

  let financeAlerts = 0;
  for (const inv of overdue ?? []) {
    if (['paid', 'cancelled', 'draft'].includes(String(inv.status))) continue;
    await raiseAlert(db, {
      alertType: 'finance_delay', severity: 'medium',
      title: 'Overdue invoice — pending payment follow-up',
      summary: `Invoice ${inv.provider_object_id} to ${inv.counterparty ?? 'customer'} is past due`,
      sourceEventTable: 'finance_events', sourceEventId: inv.id,
      evidence: { dueAt: inv.due_at, amount: inv.amount, currency: inv.currency },
      dedupKey: `fin:${inv.id}`,
    });
    financeAlerts++;
  }

  return Response.json({ ingested, financeAlerts });
});
