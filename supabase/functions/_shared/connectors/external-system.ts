// Future-facing seam for integrating OPERATIONAL systems (TMS / CRM / accounting)
// so shipment milestones, sales deals, and finance approvals can feed the same
// analysis + risk layer with ground truth — without changing anything that
// consumes the normalized event tables. Mirrors the SourceConnector discipline.
//
// Not wired yet: the hybrid decision is "infer from communications now, integrate
// one system later." When the owner names their TMS/CRM/accounting system, add an
// implementation here and an ingest-operational function; downstream is untouched.

export interface OperationalRecord {
  kind: 'shipment' | 'deal' | 'invoice_approval' | 'task';
  externalId: string;
  status?: string | null;
  ownerEmail?: string | null;
  counterparty?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ExternalSystemPull {
  records: OperationalRecord[];
  nextCursor: string | null;
  done: boolean;
}

export interface ExternalSystemConnector {
  readonly system: string; // 'tms' | 'crm' | 'accounting' | ...
  pullDelta(cursor: string | null, opts: { pageLimit: number }): Promise<ExternalSystemPull>;
}
