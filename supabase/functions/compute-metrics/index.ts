// compute-metrics — SLA / response-time + productivity engine (v2).
// Pairs inbound-external emails with the first subsequent outbound reply to derive
// first-response latency (clamped to business hours), and now also evaluates the
// followup and quotation_turnaround SLA rule types. Writes employee, department,
// and org rollups to metrics_daily — including an SLA compliance scorecard —
// and raises sla_breach alerts. Invoked by pg_cron.

import { adminClient, getPolicy, withRun } from '../_shared/db.ts';
import { raiseAlert, type Severity } from '../_shared/alerts.ts';
import { guardRequest } from '../_shared/authz.ts';
import { businessMinutesBetween, type BusinessHours } from '../_shared/time/business-hours.ts';

interface Ev {
  id: string; thread_id: string | null; direction: string; sent_at: string | null;
  owner_employee_id: string | null; owner_department_id: string | null;
  subject: string | null; snippet: string | null;
}

interface Acc { sum: number; count: number; missed: number; within: number; breach: number; out: number }
const zero = (): Acc => ({ sum: 0, count: 0, missed: 0, within: 0, breach: 0, out: 0 });
const QUOTE_INTENT = /(quotation|quote|proforma|pro forma|rate|pricing|offer|tariff)/i;

Deno.serve(async (req) => {
  const denied = guardRequest(req);
  if (denied) return denied;
  const db = adminClient();

  const result = await withRun(db, 'compute-metrics', async () => {
    const bh = await getPolicy<BusinessHours | null>(db, 'business_hours', null);
    const { data: slaRules } = await db.from('sla_rules').select('*').eq('is_active', true);
    const firstResp = new Map<string | null, number>();
    const followup = new Map<string | null, number>();
    const quotation = new Map<string | null, number>();
    for (const r of slaRules ?? []) {
      if (r.rule_type === 'first_response') firstResp.set(r.department_id, r.threshold_minutes);
      else if (r.rule_type === 'followup') followup.set(r.department_id, r.threshold_minutes);
      else if (r.rule_type === 'quotation_turnaround') quotation.set(r.department_id, r.threshold_minutes);
    }
    const globalFirst = firstResp.get(null) ?? 240;

    const nowIso = new Date().toISOString();
    const since = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    const { data: evs } = await db.from('email_events')
      .select('id, thread_id, direction, sent_at, owner_employee_id, owner_department_id, subject, snippet')
      .gte('sent_at', since).order('thread_id').order('sent_at').limit(5000);

    const byThread = new Map<string, Ev[]>();
    for (const e of (evs ?? []) as Ev[]) {
      if (!e.thread_id || !e.sent_at) continue;
      let arr = byThread.get(e.thread_id);
      if (!arr) { arr = []; byThread.set(e.thread_id, arr); }
      arr.push(e);
    }

    const today = new Date().toISOString().slice(0, 10);
    const perEmp = new Map<string, Acc>();
    const perDept = new Map<string, Acc>();
    const org = zero();
    let slaAlerts = 0;

    const bump = (m: Map<string, Acc>, k: string | null): Acc | null => {
      if (!k) return null;
      let a = m.get(k); if (!a) { a = zero(); m.set(k, a); } return a;
    };

    for (const [, list] of byThread) {
      list.sort((a, b) => (a.sent_at! < b.sent_at! ? -1 : 1));

      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.direction !== 'inbound') continue;
        const threshold = firstResp.get(e.owner_department_id) ?? globalFirst;
        const empA = bump(perEmp, e.owner_employee_id);
        const deptA = bump(perDept, e.owner_department_id);
        const reply = list.slice(i + 1).find((x) => x.direction === 'outbound');

        if (reply) {
          const mins = businessMinutesBetween(e.sent_at!, reply.sent_at!, bh);
          for (const a of [empA, deptA, org]) if (a) { a.sum += mins; a.count++; }
          const breached = mins > threshold;
          for (const a of [empA, deptA, org]) if (a) { if (breached) a.breach++; else a.within++; }
          if (breached) {
            const severity: Severity = mins > threshold * 3 ? 'high' : 'medium';
            await raiseAlert(db, {
              alertType: 'sla_breach', severity,
              title: 'SLA breach: slow first response to customer',
              summary: `First response took ${mins} business-min (SLA ${threshold}m)`,
              employeeId: e.owner_employee_id, departmentId: e.owner_department_id,
              sourceEventTable: 'email_events', sourceEventId: e.id,
              evidence: { minutes: mins, thresholdMinutes: threshold, basis: 'business_hours' },
              dedupKey: `sla:${e.id}`,
            });
            slaAlerts++;
          }

          // quotation_turnaround: the inbound looks like a quote request.
          const qThreshold = quotation.get(e.owner_department_id);
          if (qThreshold && QUOTE_INTENT.test(`${e.subject ?? ''} ${e.snippet ?? ''}`) && mins > qThreshold) {
            await raiseAlert(db, {
              alertType: 'sla_breach', severity: mins > qThreshold * 2 ? 'high' : 'medium',
              title: 'SLA breach: slow quotation turnaround',
              summary: `Quote turnaround ${mins} business-min (SLA ${qThreshold}m)`,
              employeeId: e.owner_employee_id, departmentId: e.owner_department_id,
              sourceEventTable: 'email_events', sourceEventId: e.id,
              evidence: { minutes: mins, thresholdMinutes: qThreshold, ruleType: 'quotation_turnaround' },
              dedupKey: `quote:${e.id}`,
            });
            slaAlerts++;
          }
        } else {
          const ageMin = businessMinutesBetween(e.sent_at!, nowIso, bh);
          if (ageMin > threshold) {
            for (const a of [empA, deptA, org]) if (a) { a.missed++; a.breach++; }
            await raiseAlert(db, {
              alertType: 'sla_breach', severity: ageMin > threshold * 4 ? 'high' : 'medium',
              title: 'Unanswered customer enquiry',
              summary: `No reply after ${ageMin} business-min (SLA ${threshold}m)`,
              employeeId: e.owner_employee_id, departmentId: e.owner_department_id,
              sourceEventTable: 'email_events', sourceEventId: e.id,
              evidence: { ageMinutes: ageMin, thresholdMinutes: threshold, basis: 'business_hours' },
              dedupKey: `missed:${e.id}`,
            });
            slaAlerts++;
          }
        }
      }

      // followup: an open thread whose LAST message is inbound and is now stale.
      const last = list[list.length - 1];
      if (last.direction === 'inbound' && last.sent_at) {
        const fThreshold = followup.get(last.owner_department_id);
        if (fThreshold) {
          const ageMin = businessMinutesBetween(last.sent_at, nowIso, bh);
          if (ageMin > fThreshold) {
            await raiseAlert(db, {
              alertType: 'sla_breach', severity: 'medium',
              title: 'SLA breach: pending follow-up',
              summary: `Thread awaiting reply ${ageMin} business-min (follow-up SLA ${fThreshold}m)`,
              employeeId: last.owner_employee_id, departmentId: last.owner_department_id,
              sourceEventTable: 'email_events', sourceEventId: last.id,
              evidence: { ageMinutes: ageMin, thresholdMinutes: fThreshold, ruleType: 'followup' },
              dedupKey: `followup:${last.thread_id}`,
            });
            slaAlerts++;
          }
        }
      }
    }

    // Outbound volume (24h) → workload, rolled up to dept + org.
    const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: outs } = await db.from('email_events')
      .select('owner_employee_id, owner_department_id').eq('direction', 'outbound').gte('sent_at', since24).limit(10000);
    for (const o of outs ?? []) {
      const empA = bump(perEmp, o.owner_employee_id); if (empA) empA.out++;
      const deptA = bump(perDept, o.owner_department_id); if (deptA) deptA.out++;
      org.out++;
    }

    let metricsWritten = 0;
    async function put(scopeType: 'employee' | 'department' | 'org', scopeId: string | null, key: string, value: number) {
      await db.from('metrics_daily').upsert(
        { metric_date: today, scope_type: scopeType, scope_id: scopeId, metric_key: key, metric_value: value },
        { onConflict: 'metric_date,scope_type,scope_id,metric_key' },
      );
      metricsWritten++;
    }
    async function writeAcc(scopeType: 'employee' | 'department' | 'org', scopeId: string | null, a: Acc) {
      await put(scopeType, scopeId, 'avg_first_response_min', a.count ? Math.round(a.sum / a.count) : 0);
      await put(scopeType, scopeId, 'enquiries_handled', a.count);
      await put(scopeType, scopeId, 'missed_enquiries', a.missed);
      await put(scopeType, scopeId, 'emails_out', a.out);
      await put(scopeType, scopeId, 'sla_within_count', a.within);
      await put(scopeType, scopeId, 'sla_breach_count', a.breach);
      const denom = a.within + a.breach;
      await put(scopeType, scopeId, 'sla_compliance_rate', denom ? Math.round((a.within / denom) * 100) : 100);
    }

    for (const [emp, a] of perEmp) await writeAcc('employee', emp, a);
    for (const [dept, a] of perDept) await writeAcc('department', dept, a);
    await writeAcc('org', null, org);

    return { recordsProcessed: metricsWritten, alertsRaised: slaAlerts, detail: { slaAlerts, metricsWritten } };
  });

  return Response.json(result.detail);
});
