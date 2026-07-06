import { supabase } from '../lib/supabase';
import type { JobRun, Policy, Source, SyncState } from '../lib/types';
import { useAuth } from '../lib/auth';
import { useSupabaseQuery } from '../lib/useSupabaseQuery';
import { QueryBoundary } from '../components/QueryState';
import { useToast } from '../components/Toast';
import { setSourceActive } from '../lib/mutations';

// Expected cron cadence (minutes) per source kind — a run older than 3× is stale.
const CADENCE_MIN: Record<string, number> = { gmail: 10, drive: 15, calendar: 15, paypal: 360 };

function boolPolicy(policies: Policy[], key: string): boolean {
  return Boolean(policies.find((p) => p.policy_key === key)?.value_json?.value);
}

function staleness(kind: string, lastRunAt: string | null): { label: string; tone: string } {
  if (!lastRunAt) return { label: 'never run', tone: 'text-slate-500' };
  const ageMin = (Date.now() - new Date(lastRunAt).getTime()) / 60000;
  const limit = (CADENCE_MIN[kind] ?? 60) * 3;
  return ageMin > limit
    ? { label: 'stale', tone: 'text-red-400' }
    : { label: 'fresh', tone: 'text-emerald-400' };
}

export function System() {
  const { hasRole } = useAuth();
  const canWrite = hasRole(['ceo', 'admin']);
  const { reportError } = useToast();

  const q = useSupabaseQuery<{ sources: Source[]; sync: SyncState[]; jobs: JobRun[]; policies: Policy[] }>(async () => {
    const [s, y, j, p] = await Promise.all([
      supabase.from('sources').select('id, kind, mode, display_name, is_active').order('kind'),
      supabase.from('sync_state').select('*'),
      supabase.from('job_runs').select('*').order('started_at', { ascending: false }).limit(30),
      supabase.from('policies').select('policy_key, value_json'),
    ]);
    const error = s.error ?? y.error ?? j.error ?? p.error;
    if (error) return { data: null, error };
    return {
      data: {
        sources: (s.data ?? []) as Source[],
        sync: (y.data ?? []) as SyncState[],
        jobs: (j.data ?? []) as JobRun[],
        policies: (p.data ?? []) as Policy[],
      },
      error: null,
    };
  }, []);

  const sources = q.data?.sources ?? [];
  const syncBySource = new Map((q.data?.sync ?? []).map((s) => [s.source_id, s]));
  const jobs = q.data?.jobs ?? [];
  const policies = q.data?.policies ?? [];

  async function toggleSource(id: string, next: boolean) {
    if (reportError(await setSourceActive(id, next), 'Saved.')) q.reload();
  }

  const gates = [
    { key: 'notice_delivered', label: 'Employee notice + DPIA recorded' },
    { key: 'monitoring_active', label: 'Org-wide monitoring active' },
    { key: 'store_all_bodies', label: 'Store all message bodies (should stay OFF)' },
  ];

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-100">System &amp; connectors</h1>
      <p className="mb-5 text-sm text-slate-500">Ingestion health, pipeline runs, and the go-live checklist.</p>

      <QueryBoundary loading={q.loading} error={q.error} onRetry={q.reload}>
        {/* Go-live checklist */}
        <section className="mb-8 rounded-xl border border-edge bg-panel p-4">
          <div className="mb-3 text-sm font-semibold text-slate-200">Go-live checklist</div>
          <ul className="space-y-1 text-sm">
            {gates.map((g) => {
              const on = boolPolicy(policies, g.key);
              const good = g.key === 'store_all_bodies' ? !on : on;
              return (
                <li key={g.key} className="flex items-center gap-2">
                  <span className={good ? 'text-emerald-400' : 'text-slate-500'}>{good ? '✓' : '○'}</span>
                  <span className="text-slate-300">{g.label}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-slate-500">Configure these in Settings. Org-wide collection stays inert until notice is delivered and monitoring is active.</p>
        </section>

        {/* Connectors */}
        <section className="mb-8">
          <div className="mb-2 text-sm font-semibold text-slate-200">Connectors</div>
          <div className="overflow-hidden rounded-xl border border-edge">
            <table className="w-full text-left text-sm">
              <thead className="bg-panel text-xs uppercase text-slate-400">
                <tr><th className="px-3 py-2">Source</th><th className="px-3 py-2">Mode</th><th className="px-3 py-2">Active</th><th className="px-3 py-2">Last run</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Detail</th></tr>
              </thead>
              <tbody className="divide-y divide-edge bg-panel/40">
                {sources.map((s) => {
                  const st = syncBySource.get(s.id);
                  const fresh = staleness(s.kind, st?.last_run_at ?? null);
                  return (
                    <tr key={s.id}>
                      <td className="px-3 py-2 text-slate-100">{s.display_name}<div className="text-[11px] text-slate-500">{s.kind}</div></td>
                      <td className="px-3 py-2 text-slate-400">{s.mode}</td>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={s.is_active} disabled={!canWrite}
                          onChange={(e) => toggleSource(s.id, e.target.checked)} />
                      </td>
                      <td className="px-3 py-2">
                        <span className={fresh.tone}>{st?.last_run_at ? new Date(st.last_run_at).toLocaleString() : '—'}</span>
                        <span className={`ml-1 text-[11px] ${fresh.tone}`}>({fresh.label})</span>
                      </td>
                      <td className={`px-3 py-2 ${st?.last_status === 'error' ? 'text-red-400' : 'text-slate-400'}`}>{st?.last_status ?? '—'}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-500">{st?.error_detail ?? '—'}</td>
                    </tr>
                  );
                })}
                {!sources.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">No sources configured.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {/* Pipeline runs */}
        <section>
          <div className="mb-2 text-sm font-semibold text-slate-200">Recent pipeline runs</div>
          <div className="overflow-hidden rounded-xl border border-edge">
            <table className="w-full text-left text-sm">
              <thead className="bg-panel text-xs uppercase text-slate-400">
                <tr><th className="px-3 py-2">Function</th><th className="px-3 py-2">Started</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Records</th><th className="px-3 py-2">Alerts</th><th className="px-3 py-2">Error</th></tr>
              </thead>
              <tbody className="divide-y divide-edge bg-panel/40">
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="px-3 py-2 text-slate-200">{j.function_name}</td>
                    <td className="px-3 py-2 text-slate-500">{new Date(j.started_at).toLocaleString()}</td>
                    <td className={`px-3 py-2 ${j.status === 'error' ? 'text-red-400' : j.status === 'ok' ? 'text-emerald-400' : 'text-slate-400'}`}>{j.status}</td>
                    <td className="px-3 py-2 text-slate-400">{j.records_processed ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-400">{j.alerts_raised ?? '—'}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">{j.error_detail ?? '—'}</td>
                  </tr>
                ))}
                {!jobs.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">No pipeline runs recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </QueryBoundary>
    </div>
  );
}
