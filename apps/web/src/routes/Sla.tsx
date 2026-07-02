import { useEffect, useState } from 'react';
import { supabase, isConfigured } from '../lib/supabase';
import type { Alert, MetricRow } from '../lib/types';
import { SeverityBadge } from '../components/SeverityBadge';
import { StatCard } from '../components/StatCard';

export function Sla() {
  const [breaches, setBreaches] = useState<Alert[]>([]);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.from('alerts').select('*').eq('alert_type', 'sla_breach')
      .order('last_seen_at', { ascending: false }).limit(100)
      .then(({ data }) => setBreaches((data ?? []) as Alert[]));
    supabase.from('metrics_daily').select('*')
      .in('metric_key', ['avg_first_response_min', 'missed_enquiries', 'enquiries_handled'])
      .order('metric_date', { ascending: false }).limit(300)
      .then(({ data }) => setMetrics((data ?? []) as MetricRow[]));
  }, []);

  const missed = metrics.filter((m) => m.metric_key === 'missed_enquiries').reduce((a, m) => a + m.metric_value, 0);
  const handled = metrics.filter((m) => m.metric_key === 'enquiries_handled').reduce((a, m) => a + m.metric_value, 0);
  const respVals = metrics.filter((m) => m.metric_key === 'avg_first_response_min' && m.metric_value > 0);
  const avgResp = respVals.length ? Math.round(respVals.reduce((a, m) => a + m.metric_value, 0) / respVals.length) : 0;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-100">Sales & Ops SLA</h1>
      <p className="mb-5 text-sm text-slate-500">First-response latency, missed enquiries, and SLA breaches.</p>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Open SLA breaches" value={breaches.filter((b) => b.status === 'open').length} tone={breaches.length ? 'warn' : 'ok'} />
        <StatCard label="Missed enquiries" value={missed} tone={missed ? 'danger' : 'ok'} sub="recent" />
        <StatCard label="Enquiries handled" value={handled} tone="ok" sub="recent" />
        <StatCard label="Avg first response" value={`${avgResp}m`} sub="across employees" />
      </div>

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
    </div>
  );
}
