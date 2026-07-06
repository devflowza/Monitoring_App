// report-generate — executive narrative reports. Gathers the period's alerts,
// metrics, and risk scores, and asks Claude (opus, streamed) for a markdown
// narrative + prioritized recommendations, stored in `reports`. Body: {type}.
// PDF export to Storage is a planned follow-up (narrative is stored now).
// Invoked by pg_cron (daily/weekly) or on demand.

import { adminClient, withRun } from '../_shared/db.ts';
import { generateReport } from '../_shared/claude/index.ts';
import { guardRequest } from '../_shared/authz.ts';

Deno.serve(async (req) => {
  const denied = guardRequest(req);
  if (denied) return denied;
  const db = adminClient();
  const result = await withRun(db, 'report-generate', async () => {
  const body = await req.json().catch(() => ({})) as { type?: string };
  const type = body.type ?? 'daily';
  const days = type === 'weekly' ? 7 : type === 'monthly' ? 30 : 1;
  const start = new Date(Date.now() - days * 864e5);
  const startIso = start.toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const [alerts, metrics, risks] = await Promise.all([
    db.from('alerts').select('alert_type, severity, status, title, department_id')
      .gte('first_seen_at', startIso).limit(500),
    db.from('metrics_daily').select('scope_type, scope_id, metric_key, metric_value')
      .gte('metric_date', startIso.slice(0, 10)).limit(1000),
    db.from('risk_scores').select('scope_type, scope_id, total_score, tier')
      .eq('score_date', today).order('total_score', { ascending: false }).limit(20),
  ]);

  const digest = JSON.stringify({
    period: { type, start: startIso, end: new Date().toISOString() },
    alerts: alerts.data ?? [],
    topRisks: risks.data ?? [],
    metricsSample: (metrics.data ?? []).slice(0, 200),
  });

  const system =
    'You are the compliance & risk analyst for a logistics company. From the JSON ' +
    'digest, write a concise executive report in markdown: (1) headline risk & ' +
    'compliance posture, (2) notable incidents, (3) SLA/productivity signals, ' +
    '(4) 3-6 prioritized, actionable recommendations. Reference incidents by ' +
    'metadata only; never invent data not present in the digest.';

  const narrative = await generateReport(system, digest)
    ?? '_Report generation unavailable (ANTHROPIC_API_KEY not configured)._';

  const { data: rep } = await db.from('reports').insert({
    report_type: type, scope_type: 'org',
    period_start: startIso.slice(0, 10), period_end: today,
    narrative_md: narrative, generated_by_model: 'claude-opus-4-8', status: 'final',
  }).select('id').single();

  return { recordsProcessed: 1, detail: { reportId: rep?.id, type } };
  });
  return Response.json(result.detail);
});
