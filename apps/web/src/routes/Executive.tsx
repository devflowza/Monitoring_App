import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { supabase } from '../lib/supabase';
import type { Alert, Severity } from '../lib/types';
import { StatCard } from '../components/StatCard';
import { AlertFeed } from '../components/AlertFeed';
import { useSupabaseQuery } from '../lib/useSupabaseQuery';
import { QueryBoundary } from '../components/QueryState';

const SEV_COLOR: Record<Severity, string> = {
  critical: '#f87171', high: '#fb923c', medium: '#fde047', low: '#38bdf8', info: '#94a3b8',
};

export function Executive() {
  const q = useSupabaseQuery<Alert[]>(
    () => supabase.from('alerts').select('*').eq('status', 'open').limit(1000),
    [],
  );
  const alerts = q.data ?? [];

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const a of alerts) c[a.severity] = (c[a.severity] ?? 0) + 1;
    return c;
  }, [alerts]);

  const chartData = (['critical', 'high', 'medium', 'low', 'info'] as Severity[])
    .map((s) => ({ severity: s, count: counts[s] }));
  const dlpCount = alerts.filter((a) => a.alert_type === 'dlp' || a.alert_type === 'personal_email').length;
  const exfilCount = alerts.filter((a) => a.alert_type === 'exfil' || a.alert_type === 'external_share').length;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-100">Executive Dashboard</h1>
      <p className="mb-5 text-sm text-slate-500">Real-time risk, compliance & security posture.</p>

      <QueryBoundary loading={q.loading} error={q.error} onRetry={q.reload}>
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Critical incidents" value={counts.critical} tone={counts.critical ? 'danger' : 'ok'} sub="open" />
          <StatCard label="High severity" value={counts.high} tone={counts.high ? 'warn' : 'ok'} sub="open" />
          <StatCard label="Data-leak (DLP)" value={dlpCount} tone={dlpCount ? 'warn' : 'ok'} sub="flagged emails" />
          <StatCard label="External sharing" value={exfilCount} tone={exfilCount ? 'warn' : 'ok'} sub="files exposed" />
        </div>

        <div className="rounded-xl border border-edge bg-panel p-4">
          <div className="mb-3 text-sm font-semibold text-slate-200">Open alerts by severity</div>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="severity" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} allowDecimals={false} />
                <Tooltip contentStyle={{ background: '#111a2e', border: '1px solid #1e2a44', borderRadius: 8 }} />
                <Bar dataKey="count">
                  {chartData.map((d) => <Cell key={d.severity} fill={SEV_COLOR[d.severity]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </QueryBoundary>

      <div className="mt-6">
        <div className="mb-3 text-sm font-semibold text-slate-200">Live incident feed</div>
        <AlertFeed limit={15} />
      </div>
    </div>
  );
}
