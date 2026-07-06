// report-generate — executive + compliance reports. Gathers the period's alerts,
// metrics, and risk scores (scoped to org / department / employee), plus a
// governance digest for the 'security' compliance report, and asks Claude (opus,
// structured) for a narrative + prioritized, alert-linked recommendations stored
// in `reports`. Delivered by email when configured. Body:
//   { type: daily|weekly|monthly|security, scope_type?, scope_id?, days? }
// Invoked by pg_cron (daily/weekly/monthly) or on demand.

import { adminClient, withRun } from '../_shared/db.ts';
import { generateStructuredReport } from '../_shared/claude/index.ts';
import { sendEmail } from '../_shared/notify.ts';
import { guardRequest } from '../_shared/authz.ts';

interface Body { type?: string; scope_type?: 'org' | 'department' | 'employee'; scope_id?: string; days?: number }

function windowDays(type: string, override?: number): number {
  if (override && override > 0) return override;
  if (type === 'weekly') return 7;
  if (type === 'monthly' || type === 'security') return 30;
  return 1;
}

Deno.serve(async (req) => {
  const denied = guardRequest(req);
  if (denied) return denied;
  const db = adminClient();

  const result = await withRun(db, 'report-generate', async () => {
    const body = await req.json().catch(() => ({})) as Body;
    const type = body.type ?? 'daily';
    const scopeType = body.scope_type ?? 'org';
    const scopeId = body.scope_id ?? null;
    const days = windowDays(type, body.days);
    const startIso = new Date(Date.now() - days * 864e5).toISOString();
    const startDate = startIso.slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    // --- Build the scoped digest ------------------------------------------
    let digestObj: Record<string, unknown>;
    let degraded = false;
    const degradedNotes: string[] = [];

    if (type === 'security') {
      // Governance / compliance digest: who accessed content, what changed, triage throughput.
      const [auditRes, alertStatusRes, policyRes] = await Promise.all([
        db.from('audit_log').select('action, target_table, accessed_content_class, occurred_at')
          .gte('occurred_at', startIso).order('occurred_at', { ascending: false }).limit(500),
        db.from('alerts').select('status, alert_type').gte('first_seen_at', startIso).limit(1000),
        db.from('policies').select('policy_key, updated_at').order('updated_at', { ascending: false }).limit(50),
      ]);
      if (auditRes.error || alertStatusRes.error || policyRes.error) {
        degraded = true;
        degradedNotes.push('one or more governance feeds failed to load');
      }
      digestObj = {
        period: { type, start: startIso, end: new Date().toISOString() },
        auditEvents: auditRes.data ?? [],
        alertTriage: alertStatusRes.data ?? [],
        policies: policyRes.data ?? [],
      };
    } else {
      // Operational digest, scoped to org / department / employee.
      let alertsQ = db.from('alerts').select('id, alert_type, severity, status, title, department_id, employee_id').gte('first_seen_at', startIso).limit(500);
      let metricsQ = db.from('metrics_daily').select('scope_type, scope_id, metric_key, metric_value').gte('metric_date', startDate).limit(1000);
      let risksQ = db.from('risk_scores').select('scope_type, scope_id, total_score, tier').eq('score_date', today).order('total_score', { ascending: false }).limit(20);

      if (scopeType === 'department' && scopeId) {
        alertsQ = alertsQ.eq('department_id', scopeId);
        metricsQ = metricsQ.eq('scope_id', scopeId);
        risksQ = risksQ.eq('scope_type', 'department').eq('scope_id', scopeId);
      } else if (scopeType === 'employee' && scopeId) {
        alertsQ = alertsQ.eq('employee_id', scopeId);
        metricsQ = metricsQ.eq('scope_type', 'employee').eq('scope_id', scopeId);
        risksQ = risksQ.eq('scope_type', 'employee').eq('scope_id', scopeId);
      }

      const [alerts, metrics, risks] = await Promise.all([alertsQ, metricsQ, risksQ]);
      // Fail LOUD, not confident-empty: a failed feed must not read as "all clear".
      for (const [name, res] of [['alerts', alerts], ['metrics', metrics], ['risks', risks]] as const) {
        if (res.error) { degraded = true; degradedNotes.push(`${name} query failed: ${res.error.message}`); }
      }
      digestObj = {
        period: { type, start: startIso, end: new Date().toISOString() },
        scope: { scope_type: scopeType, scope_id: scopeId },
        alerts: alerts.data ?? [],
        topRisks: risks.data ?? [],
        metricsSample: (metrics.data ?? []).slice(0, 200),
        dataQuality: degraded ? { degraded: true, notes: degradedNotes } : { degraded: false },
      };
    }

    // If input is degraded, store a draft with an explicit warning and do NOT
    // email a plausible-but-false narrative.
    if (degraded) {
      const { data: rep } = await db.from('reports').insert({
        report_type: type, scope_type: scopeType, scope_id: scopeId,
        period_start: startDate, period_end: today,
        narrative_md: `> ⚠️ Report input was degraded — some feeds failed to load, so this report is INCOMPLETE and must not be read as an all-clear.\n\n${degradedNotes.map((n) => `- ${n}`).join('\n')}`,
        recommendations_json: [], status: 'draft', generated_by_model: null,
      }).select('id').single();
      return { detail: { reportId: rep?.id, type, status: 'draft', degraded: true } };
    }

    const system =
      (type === 'security'
        ? 'You are the compliance officer for a logistics company. From the JSON governance digest, write a monthly compliance report in markdown: (1) content-access summary (who/what/why from audit events), (2) policy & configuration changes, (3) alert triage throughput and false-positive rate, (4) retention confirmations, (5) prioritized compliance recommendations. '
        : 'You are the compliance & risk analyst for a logistics company. From the JSON digest, write a concise executive report in markdown: (1) headline risk & compliance posture, (2) notable incidents, (3) SLA/productivity signals, (4) prioritized recommendations. ') +
      'Reference incidents by metadata only and by their alert id where relevant; never invent data not present in the digest. ' +
      'Return a headline, a markdown narrative, and 3-6 prioritized recommendations, each citing related_alert_ids where the digest supports it.';

    const structured = await generateStructuredReport(system, JSON.stringify(digestObj));

    const narrative = structured?.narrative_md
      ?? '_Report generation unavailable (ANTHROPIC_API_KEY not configured or model refused)._';
    const status = structured ? 'final' : 'draft';

    const { data: rep } = await db.from('reports').insert({
      report_type: type, scope_type: scopeType, scope_id: scopeId,
      period_start: startDate, period_end: today,
      narrative_md: narrative,
      recommendations_json: structured?.recommendations ?? [],
      generated_by_model: structured ? 'claude-opus-4-8' : null,
      status,
    }).select('id').single();

    // Deliver: email the finalized narrative to the CEO/admin inbox.
    let emailed = false;
    if (structured) {
      const label = scopeId ? `${type} (${scopeType})` : type;
      emailed = await sendEmail(
        `Sentinel ${label} report — ${today}`,
        `${structured.headline}\n\n${narrative}`,
      );
    }

    return { recordsProcessed: 1, detail: { reportId: rep?.id, type, status, emailed } };
  });

  return Response.json(result.detail);
});
