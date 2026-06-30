// Dev/test Gmail connector (single-account mode).
//
// At runtime, deployed edge functions cannot call the agent's MCP tools, so the
// "mcp" mode is the DEVELOPMENT path: sample/real data for the admin mailbox is
// staged into Postgres out-of-band (by the agent using the Gmail MCP tools, or
// by a seed script) and the pipeline runs against it. This connector therefore
// returns no records — it exists so the factory + ingest loop run end-to-end
// without Google credentials while org-wide delegation is being provisioned.
//
// Flip `sources.mode` to 'google_admin' to switch on real org-wide ingestion.

import {
  type ConnectorContext,
  type PullOptions,
  type PullResult,
  type SourceConnector,
} from '../types.ts';

export class McpGmailConnector implements SourceConnector {
  readonly kind = 'gmail' as const;
  readonly mode = 'mcp' as const;
  constructor(private _ctx: ConnectorContext) {}

  // deno-lint-ignore require-await
  async pullDelta(_cursor: string | null, _opts: PullOptions): Promise<PullResult> {
    return { records: [], nextCursor: new Date().toISOString(), done: true };
  }
}
