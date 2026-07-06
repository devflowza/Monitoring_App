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

/**
 * JavaScript's RegExp does not support the inline `(?i)` flag group (V8 throws
 * "Invalid group"); a `(?i)` prefix in a stored pattern must be stripped and the
 * case-insensitive `i` flag applied instead. This is the fix for the class of
 * seeded rules that previously compiled-and-threw, silently disabling ~40% of
 * the catalogue.
 */
export function normalizeRegexSource(pattern: string): string {
  return pattern.replace(/^\(\?i\)/, '');
}

/**
 * Validate a rule's pattern at write time (Settings UI) or load time. Returns an
 * error string if the pattern is unusable, or null if it compiles. Keyword rules
 * are '|'-separated token lists; regex/fingerprint rules must compile as JS regex
 * after (?i)-stripping.
 */
export function validatePattern(rule: Pick<DlpRule, 'match_type' | 'pattern'>): string | null {
  if (rule.match_type === 'keyword') {
    return rule.pattern.split('|').some((t) => t.trim()) ? null : 'keyword pattern is empty';
  }
  try {
    new RegExp(normalizeRegexSource(rule.pattern), 'i');
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Compile the regex rules once per scan; a broken pattern is logged, not swallowed. */
function compileRegexRules(rules: DlpRule[]): Map<string, RegExp> {
  const compiled = new Map<string, RegExp>();
  for (const rule of rules) {
    if (!rule || rule.match_type === 'keyword') continue;
    try {
      compiled.set(rule.id, new RegExp(normalizeRegexSource(rule.pattern), 'i'));
    } catch (e) {
      // A bad rule pattern shouldn't break the pipeline — but it must be visible,
      // not silently skipped (the old failure mode that hid the dead seed rules).
      console.error(`[dlp] rule "${rule.name}" (${rule.id}) has an invalid pattern and is inert: ${String(e)}`);
    }
  }
  return compiled;
}

function matchRule(rule: DlpRule, field: string, text: string, regex?: RegExp): DlpMatch | null {
  if (!text) return null;
  if (rule.match_type === 'keyword') {
    const hay = text.toLowerCase();
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
  // regex / fingerprint: use the pre-compiled, (?i)-normalized regex.
  if (!regex) return null;   // rule failed to compile (already logged)
  const m = regex.exec(text);
  if (m) {
    return {
      ruleId: rule.id, category: rule.category, name: rule.name,
      severityWeight: rule.severity_weight, requiresClaudeConfirm: rule.requires_claude_confirm,
      matchedOn: field, excerpt: excerptAround(text, m.index, m[0].length),
    };
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

  const activeRules = rules.filter((r) => r);
  const regexByRule = compileRegexRules(activeRules);

  const out: DlpMatch[] = [];
  const seen = new Set<string>();
  for (const rule of activeRules) {
    for (const [field, text] of fields) {
      const hit = matchRule(rule, field, text, regexByRule.get(rule.id));
      if (hit) {
        const key = `${rule.id}:${field}`;
        if (!seen.has(key)) { seen.add(key); out.push(hit); }
      }
    }
  }
  return out;
}
