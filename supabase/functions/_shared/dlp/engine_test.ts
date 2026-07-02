import { assertEquals } from 'jsr:@std/assert@1';
import { scanDlp, type DlpRule } from './engine.ts';

const rules: DlpRule[] = [
  { id: 'r1', name: 'Pricing', category: 'pricing', match_type: 'keyword', pattern: 'rate sheet|net rate', severity_weight: 70, requires_claude_confirm: true },
  { id: 'r2', name: 'Customer DB', category: 'customer_db', match_type: 'regex', pattern: '(?i)(customer|client)\\s*(list|database)', severity_weight: 80, requires_claude_confirm: true },
];

Deno.test('keyword match on body', () => {
  const m = scanDlp(rules, { subject: 'Hi', snippet: null, body: 'Please find our net rate attached', attachmentNames: [] });
  assertEquals(m.length, 1);
  assertEquals(m[0].category, 'pricing');
  assertEquals(m[0].matchedOn, 'body');
});

Deno.test('regex match on attachment name', () => {
  const m = scanDlp(rules, { subject: null, snippet: null, attachmentNames: ['customer database.xlsx'] });
  assertEquals(m.some((x) => x.category === 'customer_db'), true);
});

Deno.test('no false positive on benign text', () => {
  const m = scanDlp(rules, { subject: 'lunch', snippet: 'see you at noon', attachmentNames: [] });
  assertEquals(m.length, 0);
});

Deno.test('dedupes same rule across fields', () => {
  const m = scanDlp(rules, { subject: 'net rate', snippet: 'net rate again', attachmentNames: [] });
  // one hit per (rule, field): subject + snippet = 2 distinct field hits
  assertEquals(m.filter((x) => x.ruleId === 'r1').length, 2);
});
