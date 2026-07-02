// Org-wide Gmail connector (production). Impersonates each monitored user via
// domain-wide delegation and pulls message metadata first; full bodies + real
// attachment metadata are fetched when ctx.contentFetchAllowed is true (the
// notice/DPIA go-live gate). Also detects external auto-forwarding rules.
//
// Cursor model: ISO timestamp of the last sync. Each run queries `after:<epoch>`
// per user, so re-runs are idempotent (downstream upserts on providerMessageId).

import {
  classifyAddress,
  type ConnectorContext,
  type EmailDirection,
  type NormalizedAttachment,
  type NormalizedEmailEvent,
  type NormalizedForwardingRule,
  type NormalizedRecord,
  type PullOptions,
  type PullResult,
  type SourceConnector,
} from '../types.ts';
import { getGoogleAccessToken, SCOPES } from './auth.ts';

const SENSITIVE_EXT = /\.(xlsx?|csv|pdf|docx?|pptx?|zip|sql|db|json)$/i;

interface GmailHeader { name: string; value: string }
interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
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

function decodeB64Url(data: string): string {
  try {
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

/** Walk the MIME tree for the best text body (prefer text/plain, fall back to a
 *  crude text/html strip). This is the real "full content" the DLP layer needs. */
function extractBody(part: GmailPart | undefined): string | null {
  if (!part) return null;
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: GmailPart) => {
    if (p.mimeType === 'text/plain' && p.body?.data) plain.push(decodeB64Url(p.body.data));
    else if (p.mimeType === 'text/html' && p.body?.data) html.push(decodeB64Url(p.body.data));
    for (const c of p.parts ?? []) walk(c);
  };
  walk(part);
  if (plain.length) return plain.join('\n').trim() || null;
  if (html.length) return html.join('\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
  return null;
}

/** Extract attachment metadata (no download; sha256 fingerprinting is a later
 *  enhancement that would fetch messages.attachments.get). */
function extractAttachments(part: GmailPart | undefined): NormalizedAttachment[] {
  const out: NormalizedAttachment[] = [];
  const walk = (p: GmailPart) => {
    if (p.filename && (p.body?.attachmentId || (p.body?.size ?? 0) > 0)) {
      out.push({
        filename: p.filename,
        mimeType: p.mimeType ?? null,
        sizeBytes: p.body?.size ?? null,
        sha256: null,
        isSensitiveType: SENSITIVE_EXT.test(p.filename),
      });
    }
    for (const c of p.parts ?? []) walk(c);
  };
  walk(part);
  return out;
}

export class GoogleAdminGmailConnector implements SourceConnector {
  readonly kind = 'gmail' as const;
  readonly mode = 'google_admin' as const;
  constructor(private ctx: ConnectorContext) {}

  /** Users to monitor. TODO(track-A): the sync-directory function now owns the
   *  authoritative roster; this remains a fallback for single-mailbox dev. */
  private monitoredUsers(): string[] {
    const fromCfg = (this.ctx as unknown as { users?: string[] }).users;
    const impersonate = Deno.env.get('GOOGLE_ADMIN_IMPERSONATE_EMAIL');
    return fromCfg ?? (impersonate ? [impersonate] : []);
  }

  private async fetchForwarding(user: string, token: string): Promise<NormalizedForwardingRule | null> {
    // Requires gmail.settings.basic scope; guarded so a 403 doesn't break sync.
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}/settings/autoForwarding`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const fwd = await res.json() as { enabled?: boolean; emailAddress?: string };
    if (!fwd.enabled || !fwd.emailAddress) return null;
    const external = !classifyAddress(fwd.emailAddress, this.ctx.internalDomains, this.ctx.personalDomains).isInternal;
    return {
      kind: 'forwarding_rule',
      ownerEmail: user,
      ruleType: 'auto_forward',
      destination: fwd.emailAddress,
      isExternalDestination: external,
    };
  }

  async pullDelta(cursor: string | null, opts: PullOptions): Promise<PullResult> {
    const since = cursor ? new Date(cursor) : new Date(Date.now() - 7 * 864e5);
    const afterEpoch = Math.floor(since.getTime() / 1000);
    const records: NormalizedRecord[] = [];
    const users = this.monitoredUsers();

    for (const user of users) {
      const token = await getGoogleAccessToken(
        [SCOPES.gmailReadonly, SCOPES.gmailSettings], { subject: user },
      );

      const fwd = await this.fetchForwarding(user, token);
      if (fwd) records.push(fwd);

      const listUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}/messages`);
      listUrl.searchParams.set('q', `after:${afterEpoch}`);
      listUrl.searchParams.set('maxResults', String(Math.min(opts.pageLimit, 100)));
      const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!listRes.ok) continue;
      const { messages = [] } = await listRes.json() as { messages?: { id: string }[] };

      const fmt = this.ctx.contentFetchAllowed ? 'full' : 'metadata';
      for (const { id } of messages.slice(0, opts.pageLimit)) {
        const getUrl =
          `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}/messages/${id}?format=${fmt}`;
        const msgRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!msgRes.ok) continue;
        records.push(this.normalize(await msgRes.json() as GmailMessage, user));
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
    const fromInternal = classifyAddress(from, this.ctx.internalDomains, this.ctx.personalDomains).isInternal;
    const direction: EmailDirection = fromInternal
      ? (externalRecipients.length ? 'outbound' : 'internal')
      : 'inbound';
    const sentAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null;
    const attachments = this.ctx.contentFetchAllowed ? extractAttachments(msg.payload) : [];

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
      hasAttachments: Boolean(msg.payload?.parts?.some((p) => p.filename)),
      body: this.ctx.contentFetchAllowed ? extractBody(msg.payload) : null,
      attachments,
    };
  }
}

export { SENSITIVE_EXT };
