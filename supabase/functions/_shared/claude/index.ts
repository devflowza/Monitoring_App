// Anthropic Claude wrapper for the intelligence layer.
//
// Tiered model router + structured-output classification + prompt caching +
// refusal handling. Models (exact IDs — no date suffix):
//   haiku  → claude-haiku-4-5   high-volume DLP/intent classification (cheap)
//   sonnet → claude-sonnet-4-6  summaries, sentiment
//   opus   → claude-opus-4-8    report narratives, deep insider-threat synthesis
//
// Design notes verified against the claude-api skill:
//   * structured output uses output_config.format (NOT the deprecated output_format)
//   * the stable system prompt + rule catalog are prompt-cached; per-item content
//     is appended last so the cache prefix stays valid
//   * adaptive thinking + effort are Opus-only; Haiku rejects effort/max
//   * always check stop_reason === 'refusal' before reading content — benign
//     monitoring text can occasionally trip a classifier; callers fall back to
//     the deterministic-only path

import Anthropic from 'npm:@anthropic-ai/sdk@0';

export const MODELS = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
} as const;

export type Tier = keyof typeof MODELS;

let _client: Anthropic | null = null;
export function claude(): Anthropic {
  if (!_client) {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export interface ClassifyResult<T> {
  ok: boolean;          // false on refusal / parse failure → caller falls back
  data: T | null;
  refused: boolean;
}

/**
 * Force a strict JSON object out of Claude. Used for DLP adjudication and intent
 * classification on the high-volume (haiku) path. The system prompt + rule
 * catalog are cached; only `content` varies per call.
 */
export async function classify<T>(opts: {
  tier?: Tier;
  system: string;           // stable instructions + rule catalog (cached)
  content: string;          // per-item text (varies; appended last)
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<ClassifyResult<T>> {
  const tier = opts.tier ?? 'haiku';
  try {
    const res = await claude().messages.create({
      model: MODELS[tier],
      max_tokens: opts.maxTokens ?? 1024,
      system: [
        { type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: opts.content }],
      output_config: { format: { type: 'json_schema', schema: opts.schema } },
    });

    if (res.stop_reason === 'refusal') {
      return { ok: false, data: null, refused: true };
    }
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { ok: true, data: JSON.parse(text) as T, refused: false };
  } catch (_e) {
    // Network/parse/validation error → deterministic-only fallback upstream.
    return { ok: false, data: null, refused: false };
  }
}

/** Mid-tier summary of a flagged thread for alert context (metadata-safe input). */
export async function summarize(system: string, content: string): Promise<string | null> {
  try {
    const res = await claude().messages.create({
      model: MODELS.sonnet,
      max_tokens: 1024,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    });
    if (res.stop_reason === 'refusal') return null;
    return res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text).join('');
  } catch (_e) {
    return null;
  }
}

/**
 * Executive report narrative. Opus + adaptive thinking + high effort; streamed
 * because max_tokens is large (avoids HTTP timeouts).
 */
export async function generateReport(system: string, dataDigest: string): Promise<string | null> {
  try {
    const stream = claude().messages.stream({
      model: MODELS.opus,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: dataDigest }],
    });
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') return null;
    return final.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text).join('');
  } catch (_e) {
    return null;
  }
}

export interface StructuredReport {
  headline: string;
  narrative_md: string;
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low';
    title: string;
    rationale: string;
    related_alert_ids?: string[];
  }>;
}

/**
 * Structured executive report: same Opus + adaptive-thinking streaming path, but
 * constrained to a JSON schema so the narrative AND a prioritized, alert-linked
 * recommendation list come back together (populating reports.recommendations_json
 * for drill-through). Returns null on refusal/parse failure so the caller can
 * fall back to a degraded-but-honest report.
 */
export async function generateStructuredReport(system: string, dataDigest: string): Promise<StructuredReport | null> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'narrative_md', 'recommendations'],
    properties: {
      headline: { type: 'string' },
      narrative_md: { type: 'string' },
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['priority', 'title', 'rationale'],
          properties: {
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
            title: { type: 'string' },
            rationale: { type: 'string' },
            related_alert_ids: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  };
  try {
    const stream = claude().messages.stream({
      model: MODELS.opus,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema } },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: dataDigest }],
    });
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') return null;
    const text = final.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    return JSON.parse(text) as StructuredReport;
  } catch (_e) {
    return null;
  }
}
