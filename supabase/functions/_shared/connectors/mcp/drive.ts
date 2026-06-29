// Dev/test Drive connector (single-account mode). See mcp/gmail.ts for the
// rationale — dev data is staged into Postgres out-of-band; this returns no
// records so the pipeline runs without Google credentials.

import {
  type ConnectorContext,
  type PullOptions,
  type PullResult,
  type SourceConnector,
} from '../types.ts';

export class McpDriveConnector implements SourceConnector {
  readonly kind = 'drive' as const;
  readonly mode = 'mcp' as const;
  constructor(private _ctx: ConnectorContext) {}

  // deno-lint-ignore require-await
  async pullDelta(_cursor: string | null, _opts: PullOptions): Promise<PullResult> {
    return { records: [], nextCursor: new Date().toISOString(), done: true };
  }
}
