import { useEffect, useState } from 'react';
import { supabase, isConfigured } from '../lib/supabase';
import type { Alert } from '../lib/types';
import { SeverityBadge } from './SeverityBadge';
import { LoadingPanel, ErrorPanel } from './QueryState';

/** Live incident feed. Initial fetch + realtime INSERT/UPDATE subscription on alerts. */
export function AlertFeed({ limit = 25 }: { limit?: number }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(isConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    supabase.from('alerts')
      .select('*')
      .order('last_seen_at', { ascending: false })
      .limit(limit)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else { setAlerts((data ?? []) as Alert[]); setError(null); }
        setLoading(false);
      });

    const channel = supabase
      .channel('alerts-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, (payload) => {
        setAlerts((prev) => [payload.new as Alert, ...prev].slice(0, limit));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'alerts' }, (payload) => {
        // Triage changes (ack/resolve) and occurrence bumps propagate live.
        const updated = payload.new as Alert;
        setAlerts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      })
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [limit]);

  if (error) return <ErrorPanel error={error} />;
  if (loading) return <LoadingPanel label="Loading incidents…" />;
  if (!alerts.length) {
    return <div className="rounded-xl border border-edge bg-panel p-6 text-sm text-slate-500">No alerts yet. Detectors will populate this feed in real time.</div>;
  }

  return (
    <div className="divide-y divide-edge rounded-xl border border-edge bg-panel">
      {alerts.map((a) => (
        <div key={a.id} className="flex items-start gap-3 p-3">
          <SeverityBadge severity={a.severity} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-100">{a.title}</div>
            {a.summary && <div className="truncate text-xs text-slate-400">{a.summary}</div>}
            <div className="mt-0.5 text-[11px] text-slate-500">
              {a.alert_type} · {new Date(a.last_seen_at).toLocaleString()}
              {a.occurrence_count > 1 && ` · ×${a.occurrence_count}`}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
