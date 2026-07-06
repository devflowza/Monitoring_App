import { supabase } from '../lib/supabase';
import type { Employee, MetricRow } from '../lib/types';
import { useSupabaseQuery } from '../lib/useSupabaseQuery';
import { QueryBoundary } from '../components/QueryState';

interface Row { employeeId: string; name: string; out: number; handled: number; avgResp: number; missed: number; }

export function Productivity() {
  const q = useSupabaseQuery<Row[]>(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [metricsRes, empsRes] = await Promise.all([
      supabase.from('metrics_daily').select('*').eq('scope_type', 'employee').eq('metric_date', today).limit(2000),
      supabase.from('employees').select('id, full_name, primary_email, department_id, employment_status').limit(2000),
    ]);
    const error = metricsRes.error ?? empsRes.error;
    if (error) return { data: null, error };
    const nameById = new Map((empsRes.data ?? []).map((e: Employee) => [e.id, e.full_name]));
    const byEmp = new Map<string, Row>();
    for (const m of (metricsRes.data ?? []) as MetricRow[]) {
      if (!m.scope_id) continue;
      const r = byEmp.get(m.scope_id) ?? { employeeId: m.scope_id, name: nameById.get(m.scope_id) ?? m.scope_id, out: 0, handled: 0, avgResp: 0, missed: 0 };
      if (m.metric_key === 'emails_out') r.out = m.metric_value;
      if (m.metric_key === 'enquiries_handled') r.handled = m.metric_value;
      if (m.metric_key === 'avg_first_response_min') r.avgResp = Math.round(m.metric_value);
      if (m.metric_key === 'missed_enquiries') r.missed = m.metric_value;
      byEmp.set(m.scope_id, r);
    }
    return { data: [...byEmp.values()].sort((a, b) => b.out - a.out), error: null };
  }, []);

  const rows = q.data ?? [];
  const maxOut = Math.max(1, ...rows.map((r) => r.out));

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-100">Productivity</h1>
      <p className="mb-5 text-sm text-slate-500">Workload, response times, and missed enquiries by employee (today).</p>

      <QueryBoundary loading={q.loading} error={q.error} onRetry={q.reload}>
        <div className="overflow-hidden rounded-xl border border-edge">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel text-xs uppercase text-slate-400">
              <tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Workload (emails out)</th><th className="px-3 py-2">Handled</th><th className="px-3 py-2">Avg response</th><th className="px-3 py-2">Missed</th></tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel/40">
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="px-3 py-2 text-slate-100">{r.name}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-32 rounded bg-edge"><div className="h-2 rounded bg-sky-500" style={{ width: `${(r.out / maxOut) * 100}%` }} /></div>
                      <span className="text-slate-400">{r.out}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-400">{r.handled}</td>
                  <td className="px-3 py-2 text-slate-400">{r.avgResp}m</td>
                  <td className={`px-3 py-2 ${r.missed ? 'text-red-400' : 'text-slate-500'}`}>{r.missed}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">No productivity metrics yet (run compute-metrics).</td></tr>}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
    </div>
  );
}
