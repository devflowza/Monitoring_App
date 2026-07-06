import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Alert, Employee, RiskScore } from '../lib/types';
import { SeverityBadge } from '../components/SeverityBadge';
import { useSupabaseQuery } from '../lib/useSupabaseQuery';
import { QueryBoundary } from '../components/QueryState';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { dsarErase, dsarExport, setEmployeeMonitored } from '../lib/mutations';

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function EmployeeDetail() {
  const { id } = useParams();
  const { hasRole } = useAuth();
  const { reportError, notify } = useToast();
  const canAdmin = hasRole(['ceo', 'admin']);

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

  async function exportDsar() {
    if (!id) return;
    const res = await dsarExport(id);
    if (res.error) { notify(res.error, 'error'); return; }
    downloadJson(`dsar-${emp?.primary_email ?? id}.json`, res.data);
    notify('DSAR export downloaded (access logged).', 'success');
  }
  async function eraseDsar() {
    if (!id) return;
    const j = window.prompt('DSAR erasure justification (required):');
    if (!j || j.trim().length < 3) return;
    if (reportError(await dsarErase(id, j.trim()), 'Erasure applied and logged.')) q.reload();
  }
  async function toggleMonitored(next: boolean) {
    if (!id) return;
    if (reportError(await setEmployeeMonitored(id, next), 'Saved.')) q.reload();
  }

  return (
    <div>
      <Link to="/employees" className="text-xs text-sky-300 hover:underline">← All employees</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold text-slate-100">{emp?.full_name ?? 'Employee'}</h1>
      <p className="mb-5 text-sm text-slate-500">{emp?.primary_email} · {emp?.employment_status}</p>

      {canAdmin && emp && (
        <section className="mb-6 rounded-xl border border-edge bg-panel p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Compliance actions</div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-slate-300">
              <input type="checkbox" checked={emp.is_monitored !== false} onChange={(e) => toggleMonitored(e.target.checked)} />
              Monitored
            </label>
            <button onClick={exportDsar} className="rounded border border-edge px-3 py-1 text-xs text-slate-200 hover:bg-edge">Export data (DSAR)</button>
            <button onClick={eraseDsar} className="rounded border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10">Erase (DSAR)</button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Unchecking "Monitored" stops collection and content storage for this person; DSAR actions are written to the immutable audit log.</p>
        </section>
      )}

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
