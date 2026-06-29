import { useEffect, useState } from 'react';
import { supabase, isConfigured } from '../lib/supabase';
import type { Alert, AuditEntry } from '../lib/types';
import { SeverityBadge } from '../components/SeverityBadge';
import { useAuth } from '../lib/auth';

export function Security() {
  const { hasRole } = useAuth();
  const canSeeContent = hasRole(['ceo', 'admin']);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.from('alerts').select('*').order('last_seen_at', { ascending: false }).limit(100)
      .then(({ data }) => setAlerts((data ?? []) as Alert[]));
    supabase.from('audit_log').select('*').order('occurred_at', { ascending: false }).limit(50)
      .then(({ data }) => setAudit((data ?? []) as AuditEntry[]));
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-100">Security & DLP</h1>
      <p className="mb-5 text-sm text-slate-500">
        Data-leak detection, external sharing, and the audit-of-auditors trail.
        {canSeeContent
          ? ' You hold a content-access role; revealing message content is logged.'
          : ' Message content is restricted to CEO/admin roles (RLS-enforced).'}
      </p>

      <div className="mb-3 text-sm font-semibold text-slate-200">Alerts</div>
      <div className="mb-8 overflow-hidden rounded-xl border border-edge">
        <table className="w-full text-left text-sm">
          <thead className="bg-panel text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge bg-panel/40">
            {alerts.map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2"><SeverityBadge severity={a.severity} /></td>
                <td className="px-3 py-2 text-slate-300">{a.alert_type}</td>
                <td className="px-3 py-2 text-slate-100">{a.title}</td>
                <td className="px-3 py-2 text-slate-400">{a.status}</td>
                <td className="px-3 py-2 text-slate-500">{new Date(a.last_seen_at).toLocaleString()}</td>
              </tr>
            ))}
            {!alerts.length && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">No alerts.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mb-3 text-sm font-semibold text-slate-200">Audit log (who viewed what)</div>
      <div className="overflow-hidden rounded-xl border border-edge">
        <table className="w-full text-left text-sm">
          <thead className="bg-panel text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Class</th>
              <th className="px-3 py-2">Justification</th>
              <th className="px-3 py-2">When</th>
            </tr>
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
            {!audit.length && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">No audit entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
