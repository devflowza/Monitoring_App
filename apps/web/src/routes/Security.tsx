import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Alert, AuditEntry } from '../lib/types';
import { SeverityBadge } from '../components/SeverityBadge';
import { useAuth } from '../lib/auth';
import { setAlertStatus } from '../lib/mutations';
import { useSupabaseQuery } from '../lib/useSupabaseQuery';
import { QueryBoundary } from '../components/QueryState';
import { useToast } from '../components/Toast';
import { AlertDrawer } from '../components/AlertDrawer';

const STATUSES = ['open', 'ack', 'resolved', 'false_positive'] as const;
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

export function Security() {
  const { hasRole } = useAuth();
  const canSeeContent = hasRole(['ceo', 'admin']);
  const canTriage = hasRole(['ceo', 'admin', 'security_analyst']);
  const { reportError } = useToast();

  const q = useSupabaseQuery<{ alerts: Alert[]; audit: AuditEntry[] }>(async () => {
    const [a, l] = await Promise.all([
      supabase.from('alerts').select('*').order('last_seen_at', { ascending: false }).limit(200),
      supabase.from('audit_log').select('*').order('occurred_at', { ascending: false }).limit(50),
    ]);
    const error = a.error ?? l.error;
    if (error) return { data: null, error };
    return { data: { alerts: (a.data ?? []) as Alert[], audit: (l.data ?? []) as AuditEntry[] }, error: null };
  }, []);

  const alerts = useMemo(() => q.data?.alerts ?? [], [q.data]);
  const audit = q.data?.audit ?? [];

  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [sevFilter, setSevFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Alert | null>(null);

  const alertTypes = useMemo(() => [...new Set(alerts.map((a) => a.alert_type))].sort(), [alerts]);
  const filtered = alerts.filter((a) =>
    (!statusFilter || a.status === statusFilter) &&
    (!sevFilter || a.severity === sevFilter) &&
    (!typeFilter || a.alert_type === typeFilter) &&
    (!search || `${a.title} ${a.summary ?? ''}`.toLowerCase().includes(search.toLowerCase())),
  );

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
        {/* Filters */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded border border-edge bg-panel px-2 py-1 text-xs text-slate-200">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value)} className="rounded border border-edge bg-panel px-2 py-1 text-xs text-slate-200">
            <option value="">All severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded border border-edge bg-panel px-2 py-1 text-xs text-slate-200">
            <option value="">All types</option>
            {alertTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title/summary…"
            className="flex-1 rounded border border-edge bg-panel px-2 py-1 text-xs text-slate-100" />
          <span className="text-[11px] text-slate-500">{filtered.length} / {alerts.length}</span>
        </div>

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
              {filtered.map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-edge/40" onClick={() => setSelected(a)}>
                  <td className="px-3 py-2"><SeverityBadge severity={a.severity} /></td>
                  <td className="px-3 py-2 text-slate-300">{a.alert_type}</td>
                  <td className="px-3 py-2 text-slate-100">
                    {a.title}
                    {a.occurrence_count > 1 && <span className="ml-1 text-[11px] text-slate-500">×{a.occurrence_count}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{a.status}</td>
                  {canTriage && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <button onClick={() => triage(a.id, 'ack')} className="rounded border border-edge px-2 py-0.5 text-[11px] text-slate-300 hover:bg-edge">Ack</button>
                        <button onClick={() => triage(a.id, 'resolved')} className="rounded border border-edge px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-edge">Resolve</button>
                        <button onClick={() => triage(a.id, 'false_positive')} className="rounded border border-edge px-2 py-0.5 text-[11px] text-slate-500 hover:bg-edge">FP</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={canTriage ? 5 : 4} className="px-3 py-6 text-center text-sm text-slate-500">No alerts match.</td></tr>}
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

      {selected && <AlertDrawer alert={selected} onClose={() => setSelected(null)} onChanged={() => { q.reload(); }} />}
    </div>
  );
}
