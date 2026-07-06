// compute-metrics — SLA / response-time + productivity engine.
// Pairs inbound-external emails with the first subsequent outbound reply in the
// same thread to derive first-response latency, missed enquiries, and per-employee
// productivity, writing metrics_daily and raising sla_breach alerts.
// Invoked by pg_cron. (Business-hours clamping is a planned refinement.)

import { adminClient } from '../_shared/db.ts';
import { raiseAlert, type Severity } from '../_shared/alerts.ts';
import { guardRequest } from '../_shared/authz.ts';

interface Ev {
  id: string; thread_id: string | null; direction: string; sent_at: string | null;
  owner_employee_id: string | null; owner_department_id: string | null;
}

Deno.serve(async (req) => {
  const denied = guardRequest(req);
  if (denied) return denied;
  const db = adminClient();
  const { data: slaRules } = await db.from('sla_rules').select('*').eq('is_active', true);
  const firstResp = new Map<string | null, number>();
  for (const r of slaRules ?? []) if (r.rule_type === 'first_response') firstResp.set(r.department_id, r.threshold_minutes);
  const globalThreshold = firstResp.get(null) ?? 240;

  const since = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
  const { data: evs } = await db.from('email_events')
    .select('id, thread_id, direction, sent_at, owner_employee_id, owner_department_id')
    .gte('sent_at', since).order('thread_id').order('sent_at').limit(5000);

  const byThread = new Map<string, Ev[]>();
  for (const e of (evs ?? []) as Ev[]) {
    if (!e.thread_id || !e.sent_at) continue;
    let arr = byThread.get(e.thread_id);
    if (!arr) { arr = []; byThread.set(e.thread_id, arr); }
    arr.push(e);
  }

  const today = new Date().toISOString().slice(0, 10);
  const perEmp = new Map<string, { sum: number; count: number; missed: number }>();
  let slaAlerts = 0;

  for (const [, list] of byThread) {
    list.sort((a, b) => (a.sent_at! < b.sent_at! ? -1 : 1));
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.direction !== 'inbound') continue;
      const reply = list.slice(i + 1).find((x) => x.direction === 'outbound');
      const threshold = firstResp.get(e.owner_department_id) ?? globalThreshold;
      const emp = e.owner_employee_id ?? 'unassigned';
      const acc = perEmp.get(emp) ?? { sum: 0, count: 0, missed: 0 };

      if (reply) {
        const mins = (new Date(reply.sent_at!).getTime() - new Date(e.sent_at!).getTime()) / 60000;
        acc.sum += mins; acc.count++;
        if (mins > threshold) {
          const severity: Severity = mins > threshold * 3 ? 'high' : 'medium';
          await raiseAlert(db, {
            alertType: 'sla_breach', severity,
            title: 'SLA breach: slow first response to customer',
            summary: `First response took ${Math.round(mins)}m (SLA ${threshold}m)`,
            employeeId: e.owner_employee_id, departmentId: e.owner_department_id,
            sourceEventTable: 'email_events', sourceEventId: e.id,
            evidence: { minutes: Math.round(mins), thresholdMinutes: threshold },
            dedupKey: `sla:${e.id}`,
          });
          slaAlerts++;
        }
      } else {
        const ageMin = (Date.now() - new Date(e.sent_at!).getTime()) / 60000;
        if (ageMin > threshold) {
          acc.missed++;
          await raiseAlert(db, {
            alertType: 'sla_breach', severity: ageMin > threshold * 4 ? 'high' : 'medium',
            title: 'Unanswered customer enquiry',
            summary: `No reply after ${Math.round(ageMin)}m (SLA ${threshold}m)`,
            employeeId: e.owner_employee_id, departmentId: e.owner_department_id,
            sourceEventTable: 'email_events', sourceEventId: e.id,
            evidence: { ageMinutes: Math.round(ageMin), thresholdMinutes: threshold },
            dedupKey: `missed:${e.id}`,
          });
          slaAlerts++;
        }
      }
      perEmp.set(emp, acc);
    }
  }

  // Productivity: outbound volume per employee (24h) → workload signal.
  const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: outs } = await db.from('email_events')
    .select('owner_employee_id').eq('direction', 'outbound').gte('sent_at', since24).limit(10000);
  const volByEmp = new Map<string, number>();
  for (const o of outs ?? []) { const k = o.owner_employee_id; if (k) volByEmp.set(k, (volByEmp.get(k) ?? 0) + 1); }

  let metricsWritten = 0;
  async function put(scopeId: string, key: string, value: number) {
    await db.from('metrics_daily').upsert(
      { metric_date: today, scope_type: 'employee', scope_id: scopeId, metric_key: key, metric_value: value },
      { onConflict: 'metric_date,scope_type,scope_id,metric_key' },
    );
    metricsWritten++;
  }
  for (const [emp, acc] of perEmp) {
    if (emp === 'unassigned') continue;
    await put(emp, 'avg_first_response_min', acc.count ? acc.sum / acc.count : 0);
    await put(emp, 'enquiries_handled', acc.count);
    await put(emp, 'missed_enquiries', acc.missed);
  }
  for (const [emp, vol] of volByEmp) await put(emp, 'emails_out', vol);

  return Response.json({ slaAlerts, metricsWritten });
});
