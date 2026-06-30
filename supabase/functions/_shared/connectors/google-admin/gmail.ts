// Org-wide Gmail connector (production). Impersonates each monitored user via
// domain-wide delegation and pulls message metadata first; full bodies are
// fetched ONLY when ctx.contentFetchAllowed is true (policy gate).
//
// Cursor model: ISO timestamp of the last sync. Each run queries `after:<epoch>`
// per user, so re-runs are idempotent (downstream upserts on providerMessageId).

import {
  classifyAddress,
  type ConnectorContext,
  type EmailDirection,
  type NormalizedEmailEvent,
  type NormalizedRecord,
  type PullOptions,
  type PullResult,
  type SourceConnector,
} from '../types.ts';
import { getGoogleAccessToken, SCOPES } from './auth.ts';

const SENSITIVE_EXT = /\.(xlsx?|csv|pdf|docx?|zip|sql|db)$/i;

interface GmailHeader { name: string; value: string }
interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[]; parts?: unknown[] };
}

function header(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function parseAddrs(raw: string): string[] {
  if (!raw) return [];
  return raw.split(',')
    .map((s) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase())
    .filter(Boolean);
}

export class GoogleAdminGmailConnector implements SourceConnector {
  readonly kind = 'gmail' as const;
  readonly mode = 'google_admin' as const;
  constructor(private ctx: ConnectorContext) {}

  /** Users to monitor. TODO(phase-1): replace the config fallback with a full
   *  Admin SDK Directory `users.list` sweep so coverage is automatic. */
  private monitoredUsers(): string[] {
    const fromCfg = (this.ctx as unknown as { users?: string[] }).users;
    const impersonate = Deno.env.get('GOOGLE_ADMIN_IMPERSONATE_EMAIL');
    return fromCfg ?? (impersonate ? [impersonate] : []);
  }

  async pullDelta(cursor: string | null, opts: PullOptions): Promise<PullResult> {
    const since = cursor ? new Date(cursor) : new Date(Date.now() - 7 * 864e5);
    const afterEpoch = Math.floor(since.getTime() / 1000);
    const records: NormalizedRecord[] = [];
    const users = this.monitoredUsers();

    for (const user of users) {
      const token = await getGoogleAccessToken([SCOPES.gmailReadonly], { subject: user });
      const listUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}/messages`);
      listUrl.searchParams.set('q', `after:${afterEpoch}`);
      listUrl.searchParams.set('maxResults', String(Math.min(opts.pageLimit, 100)));

      const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!listRes.ok) continue; // logged by caller via sync_state on throttle/error
      const { messages = [] } = await listRes.json() as { messages?: { id: string }[] };

      const fmt = this.ctx.contentFetchAllowed ? 'full' : 'metadata';
      for (const { id } of messages.slice(0, opts.pageLimit)) {
        const getUrl =
          `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}/messages/${id}?format=${fmt}`;
        const msgRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!msgRes.ok) continue;
        const msg = await msgRes.json() as GmailMessage;
        records.push(this.normalize(msg, user));
      }
    }

    return { records, nextCursor: new Date().toISOString(), done: true };
  }

  private normalize(msg: GmailMessage, ownerEmail: string): NormalizedEmailEvent {
    const h = msg.payload?.headers;
    const from = parseAddrs(header(h, 'From'))[0] ?? null;
    const to = parseAddrs(header(h, 'To'));
    const cc = parseAddrs(header(h, 'Cc'));
    const subject = header(h, 'Subject');

    const recipients = [...to, ...cc];
    const externalRecipients = recipients.filter(
      (r) => !classifyAddress(r, this.ctx.internalDomains, this.ctx.personalDomains).isInternal,
    );
    const personalHit = recipients.some(
      (r) => classifyAddress(r, this.ctx.internalDomains, this.ctx.personalDomains).isPersonal,
    );
    const fromInternal = classifyAddress(from, this.ctx.internalDomains, this.ctx.personalDomains).isInternal;
    const direction: EmailDirection = fromInternal
      ? (externalRecipients.length ? 'outbound' : 'internal')
      : 'inbound';

    const sentAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null;

    return {
      kind: 'email_event',
      providerThreadId: msg.threadId,
      providerMessageId: msg.id,
      direction,
      fromEmail: from,
      toEmails: to,
      ccEmails: cc,
      ownerEmail,
      sentAt,
      subject,
      snippet: msg.snippet ?? null,
      hasAttachments: Boolean(msg.payload?.parts?.length),
      // body only when permitted; extraction of text/plain part is a small TODO.
      body: this.ctx.contentFetchAllowed ? (msg.snippet ?? null) : null,
      attachments: [],
    };
  }
}

export { SENSITIVE_EXT };
