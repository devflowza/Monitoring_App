// PayPal finance connector (production). Uses the PayPal REST API with OAuth2
// client-credentials to pull invoices + transactions → NormalizedFinanceEvent.
// Env: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_ENV ('live' | 'sandbox').

import {
  type ConnectorContext,
  type NormalizedFinanceEvent,
  type NormalizedRecord,
  type PullOptions,
  type PullResult,
  type SourceConnector,
} from '../types.ts';

function apiBase(): string {
  return Deno.env.get('PAYPAL_ENV') === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
}

async function token(): Promise<string | null> {
  const id = Deno.env.get('PAYPAL_CLIENT_ID');
  const secret = Deno.env.get('PAYPAL_SECRET');
  if (!id || !secret) return null;
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) return null;
  return (await res.json() as { access_token: string }).access_token;
}

interface PPInvoice {
  id: string;
  status?: string;
  detail?: { invoice_date?: string; payment_term?: { due_date?: string } };
  primary_recipients?: Array<{ billing_info?: { email_address?: string } }>;
  amount?: { value?: string; currency_code?: string };
}

export class PayPalConnector implements SourceConnector {
  readonly kind = 'paypal' as const;
  readonly mode: 'mcp' | 'google_admin';
  constructor(private _ctx: ConnectorContext, mode: 'mcp' | 'google_admin' = 'mcp') { this.mode = mode; }

  async pullDelta(_cursor: string | null, opts: PullOptions): Promise<PullResult> {
    const t = await token();
    if (!t) return { records: [], nextCursor: null, done: true }; // not configured

    const res = await fetch(`${apiBase()}/v2/invoicing/invoices?page_size=${Math.min(opts.pageLimit, 100)}&total_required=false`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (!res.ok) return { records: [], nextCursor: null, done: true };
    const { items = [] } = await res.json() as { items?: PPInvoice[] };

    const records: NormalizedRecord[] = items.map((inv): NormalizedFinanceEvent => ({
      kind: 'finance_event',
      providerObjectId: inv.id,
      objectType: 'invoice',
      status: (inv.status ?? '').toLowerCase(),
      counterparty: inv.primary_recipients?.[0]?.billing_info?.email_address ?? null,
      amount: inv.amount?.value ? Number(inv.amount.value) : null,
      currency: inv.amount?.currency_code ?? null,
      issuedAt: inv.detail?.invoice_date ?? null,
      dueAt: inv.detail?.payment_term?.due_date ?? null,
      paidAt: inv.status === 'PAID' ? (inv.detail?.invoice_date ?? null) : null,
    }));
    return { records, nextCursor: null, done: true };
  }
}
