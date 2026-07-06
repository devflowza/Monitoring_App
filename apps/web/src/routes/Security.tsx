import { supabase } from '../lib/supabase';
import type { Alert, AuditEntry } from '../lib/types';
import { SeverityBadge } from '../components/SeverityBadge';
import { useAuth } from '../lib/auth';
import { setAlertStatus } from '../lib/mutations';
import { useSupabaseQuery } from '../lib/useSupabaseQuery';
import { QueryBoundary } from '../components/QueryState';
import { useToast } from '../components/Toast';

export function Security() {
  const { hasRole } = useAuth();
  const canSeeContent = hasRole(['ceo', 'admin']);
  const canTriage = hasRole(['ceo', 'admin', 'security_analyst']);
  const { reportError } = useToast();

  const q = useSupabaseQuery<{ alerts: Alert[]; audit: AuditEntry[] }>(async () => {
    const [a, l] = await Promise.all([
      supabase.from('alerts').select('*').order('last_seen_at', { ascending: false }).limit(100),
      supabase.from('audit_log').select('*').order('occurred_at', { ascending: false }).limit(50),
    ]);
    const error = a.error ?? l.error;
    if (error) return { data: null, error };
    return { data: { alerts: (a.data ?? []) as Alert[], audit: (l.data ?? []) as AuditEntry[] }, error: null };
  }, []);

  const alerts = q.data?.alerts ?? [];
  const audit = q.data?.audit ?? [];

  async function triage(id: string, status: 'ack' | 'resolved' | 'false_positive') {
    if (reportError(await setAlertStatus(id, status))) q.reload();
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-100">Security & DLP</h1>
      <p className="mb-5 text-sm text-slate-500">
        Data-leak detection, external sharing, and the audit-of-auditors trail.
        {canSeeContent
          ? ' You hold a content-access role; revealing message content is logged.'
          : ' Message content is restricted to CEO/admin roles (RLS-enforced).'}
      </p>

      <QueryBoundary loading={q.loading} error={q.error} onRetry={q.reload}>
        <div className="mb-3 text-sm font-semibold text-slate-200">Alerts</div>
        <div className="mb-8 overflow-hidden rounded-xl border border-edge">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Severity</th><th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Title</th><th className="px-3 py-2">Status</th>
                {canTriage && <th className="px-3 py-2">Triage</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel/40">
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2"><SeverityBadge severity={a.severity} /></td>
                  <td className="px-3 py-2 text-slate-300">{a.alert_type}</td>
                  <td className="px-3 py-2 text-slate-100">{a.title}</td>
                  <td className="px-3 py-2 text-slate-400">{a.status}</td>
                  {canTriage && (
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => triage(a.id, 'ack')} className="rounded border border-edge px-2 py-0.5 text-[11px] text-slate-300 hover:bg-edge">Ack</button>
                        <button onClick={() => triage(a.id, 'resolved')} className="rounded border border-edge px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-edge">Resolve</button>
                        <button onClick={() => triage(a.id, 'false_positive')} className="rounded border border-edge px-2 py-0.5 text-[11px] text-slate-500 hover:bg-edge">FP</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {!alerts.length && <tr><td colSpan={canTriage ? 5 : 4} className="px-3 py-6 text-center text-sm text-slate-500">No alerts.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="mb-3 text-sm font-semibold text-slate-200">Audit log (who viewed what)</div>
        <div className="overflow-hidden rounded-xl border border-edge">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel text-xs uppercase text-slate-400">
              <tr><th className="px-3 py-2">Action</th><th className="px-3 py-2">Target</th><th className="px-3 py-2">Class</th><th className="px-3 py-2">Justification</th><th className="px-3 py-2">When</th></tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel/40">
              {audit.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 text-slate-200">{e.action}</td>
                  <td className="px-3 py-2 text-slate-400">{e.target_table ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{e.accessed_content_class ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{e.justification ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{new Date(e.occurred_at).toLocaleString()}</td>
                </tr>
              ))}
              {!audit.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">No audit entries yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
    </div>
  );
}
