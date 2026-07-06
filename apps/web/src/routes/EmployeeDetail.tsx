import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Alert, Employee, RiskScore } from '../lib/types';
import { SeverityBadge } from '../components/SeverityBadge';
import { useSupabaseQuery } from '../lib/useSupabaseQuery';
import { QueryBoundary } from '../components/QueryState';

export function EmployeeDetail() {
  const { id } = useParams();

  const q = useSupabaseQuery<{ emp: Employee | null; risk: RiskScore | null; alerts: Alert[] }>(async () => {
    if (!id) return { data: { emp: null, risk: null, alerts: [] }, error: null };
    const [e, r, a] = await Promise.all([
      supabase.from('employees').select('*').eq('id', id).maybeSingle(),
      supabase.from('risk_scores').select('*')
        .eq('scope_type', 'employee').eq('scope_id', id).order('score_date', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('alerts').select('*').eq('employee_id', id).order('last_seen_at', { ascending: false }).limit(50),
    ]);
    const error = e.error ?? r.error ?? a.error;
    if (error) return { data: null, error };
    return { data: { emp: e.data as Employee | null, risk: r.data as RiskScore | null, alerts: (a.data ?? []) as Alert[] }, error: null };
  }, [id]);

  const emp = q.data?.emp ?? null;
  const risk = q.data?.risk ?? null;
  const alerts = q.data?.alerts ?? [];

  const breakdown = risk ? Object.entries(risk.component_breakdown_json) : [];
  const maxContribution = Math.max(1, ...breakdown.map(([, v]) => v.contribution));

  return (
    <div>
      <Link to="/employees" className="text-xs text-sky-300 hover:underline">← All employees</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold text-slate-100">{emp?.full_name ?? 'Employee'}</h1>
      <p className="mb-5 text-sm text-slate-500">{emp?.primary_email} · {emp?.employment_status}</p>

      <QueryBoundary loading={q.loading} error={q.error} onRetry={q.reload}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-edge bg-panel p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <div className="text-sm font-semibold text-slate-200">Risk breakdown</div>
              <div className="text-2xl font-bold text-slate-100">{risk?.total_score ?? '—'}<span className="text-sm text-slate-500">/100</span></div>
            </div>
            {breakdown.length ? breakdown.map(([factor, v]) => (
              <div key={factor} className="mb-2">
                <div className="flex justify-between text-xs text-slate-400"><span>{factor}</span><span>{v.contribution}</span></div>
                <div className="h-2 rounded bg-edge"><div className="h-2 rounded bg-orange-500" style={{ width: `${(v.contribution / maxContribution) * 100}%` }} /></div>
              </div>
            )) : <div className="text-sm text-slate-500">No risk score yet.</div>}
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-slate-200">Recent alerts</div>
            <div className="divide-y divide-edge rounded-xl border border-edge bg-panel">
              {alerts.map((a) => (
                <div key={a.id} className="flex items-start gap-3 p-3">
                  <SeverityBadge severity={a.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-100">{a.title}</div>
                    <div className="text-[11px] text-slate-500">{a.alert_type} · {new Date(a.last_seen_at).toLocaleString()}</div>
                  </div>
                </div>
              ))}
              {!alerts.length && <div className="p-6 text-sm text-slate-500">No alerts for this employee.</div>}
            </div>
          </div>
        </div>
      </QueryBoundary>
    </div>
  );
}
