import { supabase } from '../lib/supabase';
import type { Alert, MetricRow } from '../lib/types';
import { SeverityBadge } from '../components/SeverityBadge';
import { StatCard } from '../components/StatCard';
import { useSupabaseQuery } from '../lib/useSupabaseQuery';
import { QueryBoundary } from '../components/QueryState';

interface DeptRow { deptId: string; within: number; breach: number; avg: number; missed: number; }

export function Sla() {
  const q = useSupabaseQuery<{ breaches: Alert[]; metrics: MetricRow[]; deptNames: Map<string, string> }>(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [b, m, d] = await Promise.all([
      supabase.from('alerts').select('*').eq('alert_type', 'sla_breach')
        .order('last_seen_at', { ascending: false }).limit(100),
      // Scope to the latest metric_date and org+department rows only (no more
      // triple-counting employee rows into the org totals).
      supabase.from('metrics_daily').select('*')
        .in('scope_type', ['org', 'department']).eq('metric_date', today).limit(1000),
      supabase.from('departments').select('id, name'),
    ]);
    const error = b.error ?? m.error ?? d.error;
    if (error) return { data: null, error };
    return {
      data: {
        breaches: (b.data ?? []) as Alert[],
        metrics: (m.data ?? []) as MetricRow[],
        deptNames: new Map((d.data ?? []).map((x) => [x.id as string, x.name as string])),
      },
      error: null,
    };
  }, []);

  const breaches = q.data?.breaches ?? [];
  const metrics = q.data?.metrics ?? [];
  const deptNames = q.data?.deptNames ?? new Map();

  const org = (key: string): number =>
    metrics.find((m) => m.scope_type === 'org' && m.metric_key === key)?.metric_value ?? 0;

  const deptRows: DeptRow[] = Array.from(
    metrics.filter((m) => m.scope_type === 'department' && m.scope_id).reduce((acc, m) => {
      const r = acc.get(m.scope_id!) ?? { deptId: m.scope_id!, within: 0, breach: 0, avg: 0, missed: 0 };
      if (m.metric_key === 'sla_within_count') r.within = m.metric_value;
      if (m.metric_key === 'sla_breach_count') r.breach = m.metric_value;
      if (m.metric_key === 'avg_first_response_min') r.avg = Math.round(m.metric_value);
      if (m.metric_key === 'missed_enquiries') r.missed = m.metric_value;
      acc.set(m.scope_id!, r);
      return acc;
    }, new Map<string, DeptRow>()).values(),
  ).sort((a, b) => (a.within + a.breach === 0 ? 1 : a.within / (a.within + a.breach)) - (b.within + b.breach === 0 ? 1 : b.within / (b.within + b.breach)));

  const complianceRate = org('sla_compliance_rate');

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-100">Sales & Ops SLA</h1>
      <p className="mb-5 text-sm text-slate-500">First-response latency (business-hours), missed enquiries, and SLA compliance.</p>

      <QueryBoundary loading={q.loading} error={q.error} onRetry={q.reload}>
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="SLA compliance" value={`${complianceRate}%`} tone={complianceRate >= 90 ? 'ok' : complianceRate >= 70 ? 'warn' : 'danger'} sub="org, today" />
          <StatCard label="Open SLA breaches" value={breaches.filter((b) => b.status === 'open').length} tone={breaches.length ? 'warn' : 'ok'} />
          <StatCard label="Missed enquiries" value={org('missed_enquiries')} tone={org('missed_enquiries') ? 'danger' : 'ok'} sub="today" />
          <StatCard label="Avg first response" value={`${org('avg_first_response_min')}m`} sub="business-min, org" />
        </div>

        {/* Department scorecard */}
        <div className="mb-3 text-sm font-semibold text-slate-200">Department SLA scorecard</div>
        <div className="mb-8 overflow-hidden rounded-xl border border-edge">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel text-xs uppercase text-slate-400">
              <tr><th className="px-3 py-2">Department</th><th className="px-3 py-2">Compliance</th><th className="px-3 py-2">On-time</th><th className="px-3 py-2">Breached</th><th className="px-3 py-2">Avg response</th><th className="px-3 py-2">Missed</th></tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel/40">
              {deptRows.map((r) => {
                const denom = r.within + r.breach;
                const rate = denom ? Math.round((r.within / denom) * 100) : 100;
                return (
                  <tr key={r.deptId}>
                    <td className="px-3 py-2 text-slate-100">{deptNames.get(r.deptId) ?? r.deptId}</td>
                    <td className={`px-3 py-2 font-semibold ${rate >= 90 ? 'text-emerald-400' : rate >= 70 ? 'text-yellow-300' : 'text-red-400'}`}>{rate}%</td>
                    <td className="px-3 py-2 text-slate-400">{r.within}</td>
                    <td className="px-3 py-2 text-slate-400">{r.breach}</td>
                    <td className="px-3 py-2 text-slate-400">{r.avg}m</td>
                    <td className={`px-3 py-2 ${r.missed ? 'text-red-400' : 'text-slate-500'}`}>{r.missed}</td>
                  </tr>
                );
              })}
              {!deptRows.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">No department metrics yet (run compute-metrics).</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="mb-3 text-sm font-semibold text-slate-200">Recent breaches</div>
        <div className="overflow-hidden rounded-xl border border-edge">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel text-xs uppercase text-slate-400">
              <tr><th className="px-3 py-2">Severity</th><th className="px-3 py-2">Title</th><th className="px-3 py-2">Detail</th><th className="px-3 py-2">When</th></tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel/40">
              {breaches.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2"><SeverityBadge severity={b.severity} /></td>
                  <td className="px-3 py-2 text-slate-100">{b.title}</td>
                  <td className="px-3 py-2 text-slate-400">{b.summary}</td>
                  <td className="px-3 py-2 text-slate-500">{new Date(b.last_seen_at).toLocaleString()}</td>
                </tr>
              ))}
              {!breaches.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-500">No SLA breaches.</td></tr>}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
    </div>
  );
}
