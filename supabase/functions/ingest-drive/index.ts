// ingest-drive — pull external file-sharing permissions from each active drive
// source and upsert into file_permissions (the exfiltration-detection spine).
// Idempotent; advances per-source cursors. Invoked by pg_cron.

import { adminClient, getPolicy } from '../_shared/db.ts';
import { connectorFactory, type SourceRow } from '../_shared/connectors/factory.ts';
import type { ConnectorContext } from '../_shared/connectors/types.ts';

Deno.serve(async () => {
  const db = adminClient();
  const internalDomains = await getPolicy<string[]>(db, 'internal_domains', ['visionfreights.com']);
  const { data: sources } = await db.from('sources').select('*').eq('kind', 'drive').eq('is_active', true);
  let total = 0;

  for (const source of (sources ?? []) as SourceRow[]) {
    const ctx: ConnectorContext = {
      sourceId: source.id, contentFetchAllowed: false, internalDomains, personalDomains: [],
    };
    const { data: state } = await db.from('sync_state').select('cursor').eq('source_id', source.id).maybeSingle();
    try {
      const connector = connectorFactory(source, ctx);
      const result = await connector.pullDelta(state?.cursor ?? null, { pageLimit: 100 });
      for (const rec of result.records) {
        if (rec.kind === 'file_permission') {
          await db.from('file_permissions').insert({
            source_id: source.id,
            provider_file_id: rec.providerFileId,
            file_name: rec.fileName ?? null,
            permission_type: rec.permissionType,
            grantee: rec.grantee ?? null,
            is_external: rec.isExternal ?? false,
            is_public_link: rec.isPublicLink ?? false,
            role: rec.role ?? null,
          });
          total++;
        }
      }
      await db.from('sync_state').upsert({
        source_id: source.id, cursor: result.nextCursor,
        last_run_at: new Date().toISOString(), last_status: 'ok',
      }, { onConflict: 'source_id' });
    } catch (e) {
      await db.from('sync_state').upsert({
        source_id: source.id, last_run_at: new Date().toISOString(),
        last_status: 'error', error_detail: String(e),
      }, { onConflict: 'source_id' });
    }
  }
  return Response.json({ ingested: total });
});
