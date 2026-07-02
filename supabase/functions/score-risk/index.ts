// score-risk — transparent, auditable per-employee & per-department risk scores
// with BEHAVIORAL BASELINING. Recent (0-30d) incident rates per factor are
// scored relative to the employee's own prior baseline (30-90d), so a spike is
// weighted higher than a steady-state level. Claude is NOT used to compute the
// number (keeps it explainable); it only narrates high scores elsewhere.
// Invoked nightly by pg_cron.

import { adminClient } from '../_shared/db.ts';
import { computeRisk, type RiskFactor, type RiskWeights } from '../_shared/risk/score.ts';
import { raiseAlert } from '../_shared/alerts.ts';

const TYPE_TO_FACTOR: Record<string, string> = {
  dlp: 'dlp_incident',
  personal_email: 'personal_email',
  external_share: 'external_sharing',
  exfil: 'external_sharing',
  forwarding_rule: 'forwarding_rule',
  sla_breach: 'sla_breach',
  finance_suspicious: 'finance_suspicion',
  anomaly: 'offhours_anomaly',
  login_anomaly: 'offhours_anomaly',
};
const CAP = 5; // incidents/30d that saturate a factor at 1.0

Deno.serve(async () => {
  const db = adminClient();
  const { data: weightRows } = await db.from('risk_weights').select('factor_key, weight');
  const weights: RiskWeights = {};
  for (const w of weightRows ?? []) weights[w.factor_key] = Number(w.weight);

  const now = Date.now();
  const d30 = new Date(now - 30 * 864e5).toISOString();
  const d90 = new Date(now - 90 * 864e5).toISOString();

  const { data: alerts } = await db.from('alerts')
    .select('alert_type, employee_id, department_id, first_seen_at')
    .gte('first_seen_at', d90).not('employee_id', 'is', null).limit(10000);

  const recent = new Map<string, Record<string, number>>();
  const baseline = new Map<string, Record<string, number>>();
  const deptOf = new Map<string, string | null>();
  for (const a of alerts ?? []) {
    const factor = TYPE_TO_FACTOR[a.alert_type];
    if (!factor || !a.employee_id) continue;
    deptOf.set(a.employee_id, a.department_id);
    const bucket = a.first_seen_at >= d30 ? recent : baseline;
    const m = bucket.get(a.employee_id) ?? {};
    m[factor] = (m[factor] ?? 0) + 1;
    bucket.set(a.employee_id, m);
  }

  const today = new Date().toISOString().slice(0, 10);
  const employees = new Set<string>([...recent.keys(), ...baseline.keys()]);
  const deptScores = new Map<string, number[]>();
  let scored = 0;

  for (const emp of employees) {
    const rec = recent.get(emp) ?? {};
    const base = baseline.get(emp) ?? {};
    const factors: RiskFactor[] = Object.keys(weights).map((key) => {
      const r = rec[key] ?? 0;
      const bRate = (base[key] ?? 0) / 2; // 60d baseline window → per-30d rate
      let value = Math.min(1, r / CAP);
      if (bRate > 0 && r > bRate * 1.5) value = Math.min(1, value * 1.4); // anomaly bump
      return { key, value };
    });
    const result = computeRisk(factors, weights);

    const { data: prev } = await db.from('risk_scores')
      .select('total_score').eq('scope_type', 'employee').eq('scope_id', emp)
      .order('score_date', { ascending: false }).limit(1).maybeSingle();
    const trend = prev ? result.totalScore - Number(prev.total_score) : null;

    await db.from('risk_scores').upsert({
      scope_type: 'employee', scope_id: emp, score_date: today,
      total_score: result.totalScore, component_breakdown_json: result.breakdown,
      tier: result.tier, trend_vs_prev: trend, model_version: 'v2-baseline',
    }, { onConflict: 'scope_type,scope_id,score_date' });
    scored++;

    const dept = deptOf.get(emp);
    if (dept) { const arr = deptScores.get(dept) ?? []; arr.push(result.totalScore); deptScores.set(dept, arr); }

    if (result.tier === 'critical') {
      await raiseAlert(db, {
        alertType: 'insider_threat', severity: 'critical',
        title: 'Employee risk score reached critical',
        summary: `Composite risk ${result.totalScore}/100 (baseline-adjusted)`,
        employeeId: emp, departmentId: dept ?? null,
        evidence: { breakdown: result.breakdown },
        dedupKey: `risk:${emp}:${today}`,
      });
    }
  }

  for (const [dept, scores] of deptScores) {
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const tier = avg >= 75 ? 'critical' : avg >= 50 ? 'high' : avg >= 25 ? 'elevated' : 'low';
    await db.from('risk_scores').upsert(
      { scope_type: 'department', scope_id: dept, score_date: today, total_score: avg, component_breakdown_json: {}, tier, model_version: 'v2-baseline' },
      { onConflict: 'scope_type,scope_id,score_date' },
    );
  }

  return Response.json({ scored });
});
