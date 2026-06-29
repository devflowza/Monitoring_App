// Deterministic DLP pre-filter. Runs cheap keyword/regex matching from dlp_rules
// against email metadata/snippet (and body when content fetch is permitted) to
// produce CANDIDATES. Only candidates with requires_claude_confirm escalate to
// the claude/ adjudicator — keeps the AI spend proportional to risk.

export interface DlpRule {
  id: string;
  name: string;
  category: string;
  match_type: 'keyword' | 'regex' | 'fingerprint';
  pattern: string;
  severity_weight: number;
  requires_claude_confirm: boolean;
}

export interface DlpMatch {
  ruleId: string;
  category: string;
  name: string;
  severityWeight: number;
  requiresClaudeConfirm: boolean;
  matchedOn: string;        // which field hit (subject/snippet/attachment/body)
  excerpt: string;          // short, redaction-safe snippet around the hit
}

function excerptAround(haystack: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 24);
  const end = Math.min(haystack.length, idx + len + 24);
  return haystack.slice(start, end).replace(/\s+/g, ' ').trim();
}

function matchRule(rule: DlpRule, field: string, text: string): DlpMatch | null {
  if (!text) return null;
  const hay = text.toLowerCase();
  if (rule.match_type === 'keyword') {
    // pattern is '|'-separated, case-insensitive tokens
    for (const token of rule.pattern.split('|').map((t) => t.trim().toLowerCase())) {
      if (!token) continue;
      const idx = hay.indexOf(token);
      if (idx >= 0) {
        return {
          ruleId: rule.id, category: rule.category, name: rule.name,
          severityWeight: rule.severity_weight, requiresClaudeConfirm: rule.requires_claude_confirm,
          matchedOn: field, excerpt: excerptAround(text, idx, token.length),
        };
      }
    }
    return null;
  }
  // regex / fingerprint both treated as regex here
  try {
    const re = new RegExp(rule.pattern, rule.pattern.startsWith('(?i)') ? '' : 'i');
    const m = re.exec(text);
    if (m) {
      return {
        ruleId: rule.id, category: rule.category, name: rule.name,
        severityWeight: rule.severity_weight, requiresClaudeConfirm: rule.requires_claude_confirm,
        matchedOn: field, excerpt: excerptAround(text, m.index, m[0].length),
      };
    }
  } catch (_e) {
    // a bad rule pattern shouldn't break the pipeline
  }
  return null;
}

export interface DlpScanInput {
  subject?: string | null;
  snippet?: string | null;
  attachmentNames?: string[];
  body?: string | null;     // only present when content fetch is permitted
}

/** Returns all rule hits across the provided fields (deduped by ruleId+field). */
export function scanDlp(rules: DlpRule[], input: DlpScanInput): DlpMatch[] {
  const fields: Array<[string, string]> = [];
  if (input.subject) fields.push(['subject', input.subject]);
  if (input.snippet) fields.push(['snippet', input.snippet]);
  if (input.body) fields.push(['body', input.body]);
  for (const name of input.attachmentNames ?? []) fields.push(['attachment', name]);

  const out: DlpMatch[] = [];
  const seen = new Set<string>();
  for (const rule of rules.filter((r) => r)) {
    for (const [field, text] of fields) {
      const hit = matchRule(rule, field, text);
      if (hit) {
        const key = `${rule.id}:${field}`;
        if (!seen.has(key)) { seen.add(key); out.push(hit); }
      }
    }
  }
  return out;
}
