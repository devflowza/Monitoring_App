// =============================================================================
// SourceConnector — the load-bearing abstraction.
//
// Every ingestion source (Gmail, Drive, Calendar, PayPal) implements this one
// interface and emits the SAME normalized DTOs. Two families of implementations
// live behind it:
//   * google-admin/  — org-wide production (service account + domain-wide
//                       delegation calling Google REST APIs)
//   * mcp/           — single-account dev/test path
// Downstream code (analyze, score, alert, dashboard) reads ONLY from the
// normalized Postgres tables, never from a connector — so swapping dev↔org-wide
// is a `sources.mode` change, not a rewrite.
// =============================================================================

export type SourceKind = 'gmail' | 'drive' | 'calendar' | 'paypal';
export type ConnectorMode = 'mcp' | 'google_admin';
export type EmailDirection = 'inbound' | 'outbound' | 'internal';

// --- Normalized DTOs (shapes mirror the evt_* tables) ------------------------

export interface NormalizedAttachment {
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  isSensitiveType?: boolean;
}

export interface NormalizedEmailThread {
  kind: 'email_thread';
  providerThreadId: string;
  subject?: string | null;
  firstMessageAt?: string | null;
  lastMessageAt?: string | null;
  participantInternalCount?: number;
  participantExternalCount?: number;
}

export interface NormalizedEmailEvent {
  kind: 'email_event';
  providerThreadId: string;
  providerMessageId: string;
  direction: EmailDirection;
  fromEmail?: string | null;
  toEmails: string[];
  ccEmails?: string[];
  bccEmails?: string[];
  /** Mailbox owner this event is attributed to (for RLS dept scoping). */
  ownerEmail?: string | null;
  sentAt?: string | null;
  hasAttachments?: boolean;
  subject?: string | null;
  snippet?: string | null;
  /** Full body — present ONLY when a content fetch is permitted by policy. */
  body?: string | null;
  attachments?: NormalizedAttachment[];
}

export interface NormalizedFilePermission {
  kind: 'file_permission';
  providerFileId: string;
  fileName?: string | null;
  permissionType: 'user' | 'group' | 'domain' | 'anyone';
  grantee?: string | null;
  isExternal?: boolean;
  isPublicLink?: boolean;
  role?: string | null;
}

export interface NormalizedFileEvent {
  kind: 'file_event';
  providerFileId: string;
  actorEmail?: string | null;
  action: 'created' | 'modified' | 'shared' | 'downloaded' | 'exported' | 'permission_change';
  fileName?: string | null;
  mimeType?: string | null;
  isSensitiveType?: boolean;
  occurredAt?: string | null;
}

export interface NormalizedCalendarEvent {
  kind: 'calendar_event';
  providerEventId: string;
  organizerEmail?: string | null;
  attendeeEmails?: string[];
  title?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  hasExternalAttendees?: boolean;
}

export interface NormalizedFinanceEvent {
  kind: 'finance_event';
  providerObjectId: string;
  objectType: 'invoice' | 'transaction' | 'dispute';
  status?: string | null;
  counterparty?: string | null;
  amount?: number | null;
  currency?: string | null;
  issuedAt?: string | null;
  dueAt?: string | null;
  paidAt?: string | null;
}

export interface NormalizedForwardingRule {
  kind: 'forwarding_rule';
  ownerEmail: string;
  ruleType: 'auto_forward' | 'filter';
  destination?: string | null;
  isExternalDestination?: boolean;
}

export type NormalizedRecord =
  | NormalizedEmailThread
  | NormalizedEmailEvent
  | NormalizedFilePermission
  | NormalizedFileEvent
  | NormalizedCalendarEvent
  | NormalizedFinanceEvent
  | NormalizedForwardingRule;

// --- Connector contract ------------------------------------------------------

export interface PullOptions {
  /** Max records to return in one invocation (keeps edge functions bounded). */
  pageLimit: number;
  /** Optional: widen the window for first-run backfill. */
  backfill?: boolean;
}

export interface PullResult {
  records: NormalizedRecord[];
  /** Opaque cursor persisted to sync_state for the next incremental run. */
  nextCursor: string | null;
  /** True when no more pages remain for this window. */
  done: boolean;
}

export interface ConnectorContext {
  sourceId: string;
  /** Whether policy currently permits fetching full message bodies. */
  contentFetchAllowed: boolean;
  /** Set of internal email domains (to classify direction/external). */
  internalDomains: string[];
  /** Personal-account domains for the personal-email signal. */
  personalDomains: string[];
}

export interface SourceConnector {
  readonly kind: SourceKind;
  readonly mode: ConnectorMode;
  /**
   * Pull the delta since `cursor`. Implementations MUST be idempotent at the
   * record level (downstream upserts on provider IDs) and MUST respect
   * ctx.contentFetchAllowed before populating NormalizedEmailEvent.body.
   */
  pullDelta(cursor: string | null, opts: PullOptions): Promise<PullResult>;
}

// Shared helper: classify an address relative to the org.
export function classifyAddress(
  email: string | null | undefined,
  internalDomains: string[],
  personalDomains: string[],
): { isInternal: boolean; isPersonal: boolean } {
  if (!email) return { isInternal: false, isPersonal: false };
  const domain = email.toLowerCase().split('@')[1] ?? '';
  return {
    isInternal: internalDomains.includes(domain),
    isPersonal: personalDomains.includes(domain),
  };
}
