// Connector factory — returns the right implementation for a `sources` row.
// This is the ONLY place that knows about concrete connector classes; ingest
// functions stay mode-agnostic.

import type { ConnectorContext, SourceConnector } from './types.ts';
import { GoogleAdminGmailConnector } from './google-admin/gmail.ts';
import { GoogleAdminDriveConnector } from './google-admin/drive.ts';
import { McpGmailConnector } from './mcp/gmail.ts';
import { McpDriveConnector } from './mcp/drive.ts';

export interface SourceRow {
  id: string;
  kind: 'gmail' | 'drive' | 'calendar' | 'paypal';
  mode: 'mcp' | 'google_admin';
  config_json: Record<string, unknown>;
}

export function connectorFactory(source: SourceRow, ctx: ConnectorContext): SourceConnector {
  const key = `${source.mode}:${source.kind}`;
  switch (key) {
    case 'google_admin:gmail':
      return new GoogleAdminGmailConnector(ctx);
    case 'google_admin:drive':
      return new GoogleAdminDriveConnector(ctx);
    case 'mcp:gmail':
      return new McpGmailConnector(ctx);
    case 'mcp:drive':
      return new McpDriveConnector(ctx);
    // calendar / paypal connectors land in later phases
    default:
      throw new Error(`No connector registered for ${key}`);
  }
}
