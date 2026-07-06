import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Report } from '../lib/types';
import { useSupabaseQuery } from '../lib/useSupabaseQuery';
import { QueryBoundary } from '../components/QueryState';
import { Markdown } from '../components/Markdown';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { requestReport } from '../lib/mutations';

const PRIORITY_STYLE: Record<string, string> = {
  high: 'border-red-500/40 text-red-300', medium: 'border-yellow-500/40 text-yellow-200', low: 'border-sky-500/40 text-sky-300',
};

function download(name: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function Reports() {
  const { hasRole } = useAuth();
  const { reportError, notify } = useToast();
  const canGenerate = hasRole(['ceo', 'admin', 'security_analyst']);
  const q = useSupabaseQuery<Report[]>(
    () => supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(50),
    [],
  );
  const reports = q.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [genType, setGenType] = useState('daily');
  const [busy, setBusy] = useState(false);
  const selected = reports.find((r) => r.id === selectedId) ?? reports[0] ?? null;

  async function generate() {
    setBusy(true);
    const ok = reportError(await requestReport(genType));
    setBusy(false);
    if (ok) notify('Report generation requested — it will appear here shortly.', 'success');
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-100">Reports</h1>
        {canGenerate && (
          <div className="flex items-center gap-2">
            <select value={genType} onChange={(e) => setGenType(e.target.value)} className="rounded border border-edge bg-panel px-2 py-1 text-xs text-slate-200">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="security">Monthly compliance</option>
            </select>
            <button disabled={busy} onClick={generate} className="rounded bg-sky-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
              {busy ? 'Requesting…' : 'Generate'}
            </button>
          </div>
        )}
      </div>
      <p className="mb-5 text-sm text-slate-500">Daily, weekly, and monthly executive narratives with recommendations.</p>

      <QueryBoundary loading={q.loading} error={q.error} onRetry={q.reload}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <div className="divide-y divide-edge rounded-xl border border-edge bg-panel">
              {reports.map((r) => (
                <button key={r.id} onClick={() => setSelectedId(r.id)}
                  className={`block w-full px-3 py-2 text-left text-sm ${selected?.id === r.id ? 'bg-edge text-slate-100' : 'text-slate-300 hover:bg-edge/50'}`}>
                  <div className="font-medium capitalize">{r.report_type} report {r.status === 'draft' && <span className="text-[10px] text-amber-300">(draft)</span>}</div>
                  <div className="text-[11px] text-slate-500">{r.period_start} → {r.period_end}</div>
                </button>
              ))}
              {!reports.length && <div className="p-6 text-sm text-slate-500">No reports yet — generate one above or run report-generate.</div>}
            </div>
          </div>
          <div className="lg:col-span-2">
            {selected ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-edge bg-panel p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold capitalize text-slate-200">{selected.report_type} report</div>
                    <button onClick={() => download(`sentinel-${selected.report_type}-${selected.period_end}.md`, selected.narrative_md ?? '')}
                      className="rounded border border-edge px-2 py-1 text-xs text-slate-300 hover:bg-edge">Download .md</button>
                  </div>
                  {selected.narrative_md ? <Markdown source={selected.narrative_md} /> : <div className="text-sm text-slate-500">No narrative.</div>}
                </div>

                {(selected.recommendations_json ?? []).length > 0 && (
                  <div>
                    <div className="mb-2 text-sm font-semibold text-slate-200">Recommendations</div>
                    <div className="space-y-2">
                      {(selected.recommendations_json ?? []).map((rec, i) => (
                        <div key={i} className={`rounded-lg border bg-panel p-3 ${PRIORITY_STYLE[rec.priority] ?? 'border-edge'}`}>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold uppercase">{rec.priority}</span>
                            <span className="text-sm font-medium text-slate-100">{rec.title}</span>
                          </div>
                          <div className="mt-1 text-sm text-slate-400">{rec.rationale}</div>
                          {rec.related_alert_ids && rec.related_alert_ids.length > 0 && (
                            <Link to="/security" className="mt-1 inline-block text-[11px] text-sky-300 hover:underline">
                              {rec.related_alert_ids.length} related alert(s) ↗
                            </Link>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : <div className="rounded-xl border border-edge bg-panel p-4 text-sm text-slate-500">Select a report.</div>}
          </div>
        </div>
      </QueryBoundary>
    </div>
  );
}
