// Golden-set evaluation of the deterministic DLP pre-filter.
//
// The pre-filter is a HIGH-RECALL first stage (Claude adjudicates precision), so
// the property that matters is: every genuine disclosure — including
// prompt-injection attempts that also disclose — is caught. This suite is the
// regression guard that would have caught the (?i)-regex bug that silently
// disabled ~40% of the catalogue. It also bounds pre-filter false positives on
// benign mail so rule edits can't make the analyst's queue unusable.
//
// The `RULES` below mirror the seeded catalogue in 0002_seed.sql; keep them in
// sync when the seed changes.

import { assert } from 'jsr:@std/assert@1';
import { scanDlp, type DlpRule } from '../engine.ts';

const RULES: DlpRule[] = [
  { id: 'r-pricing',    name: 'Pricing',     category: 'pricing',     match_type: 'keyword', pattern: 'price list|rate sheet|freight rate|our rate|net rate|buying rate|selling rate|cost price', severity_weight: 70, requires_claude_confirm: true },
  { id: 'r-quote',      name: 'Quotation',   category: 'quotation',   match_type: 'keyword', pattern: 'quotation|quote no|quote ref|proforma|pro forma|offer letter', severity_weight: 60, requires_claude_confirm: true },
  { id: 'r-contract',   name: 'Contract',    category: 'contract',    match_type: 'keyword', pattern: 'contract|agreement|mou|nda|terms and conditions|signed copy', severity_weight: 55, requires_claude_confirm: true },
  { id: 'r-customerdb', name: 'Customer DB', category: 'customer_db', match_type: 'regex',   pattern: '(?i)(customer|client|contact)\\s*(list|database|export|dump)', severity_weight: 80, requires_claude_confirm: true },
  { id: 'r-financial',  name: 'Financial',   category: 'financial',   match_type: 'keyword', pattern: 'invoice|bank statement|balance sheet|p&l|profit and loss|payment details|swift|iban', severity_weight: 65, requires_claude_confirm: true },
  { id: 'r-pii',        name: 'PII',         category: 'pii',         match_type: 'regex',   pattern: '(?i)\\b(passport|emirates id|national id|visa number)\\b', severity_weight: 60, requires_claude_confirm: true },
  { id: 'r-creds',      name: 'Credentials', category: 'credentials', match_type: 'regex',   pattern: '(?i)(password|api[_ ]?key|secret|access token)\\s*[:=]', severity_weight: 75, requires_claude_confirm: false },
];

interface Fixture { id: string; label: string; category?: string; subject: string; snippet: string; attachments: string[]; }

async function loadFixtures(): Promise<Fixture[]> {
  const text = await Deno.readTextFile(new URL('./fixtures.jsonl', import.meta.url));
  return text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Fixture);
}

function flags(f: Fixture): boolean {
  return scanDlp(RULES, { subject: f.subject, snippet: f.snippet, attachmentNames: f.attachments }).length > 0;
}

Deno.test('DLP pre-filter recall: every disclosure and injection is flagged', async () => {
  const fx = await loadFixtures();
  const positives = fx.filter((f) => f.label === 'disclose' || f.label === 'injection');
  const missed = positives.filter((f) => !flags(f)).map((f) => f.id);
  assert(missed.length === 0, `pre-filter missed disclosures: ${missed.join(', ')}`);
});

Deno.test('DLP pre-filter precision: bounded false positives on benign mail', async () => {
  const fx = await loadFixtures();
  const benign = fx.filter((f) => f.label === 'benign');
  const flagged = benign.filter(flags);
  const fpRate = flagged.length / benign.length;
  assert(fpRate <= 0.3, `pre-filter FP rate ${fpRate.toFixed(2)} > 0.30 (flagged: ${flagged.map((f) => f.id).join(', ')})`);
});
