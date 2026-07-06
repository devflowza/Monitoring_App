import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Report } from '../lib/types';
import { useSupabaseQuery } from '../lib/useSupabaseQuery';
import { QueryBoundary } from '../components/QueryState';

export function Reports() {
  const q = useSupabaseQuery<Report[]>(
    () => supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(50),
    [],
  );
  const reports = q.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = reports.find((r) => r.id === selectedId) ?? reports[0] ?? null;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-100">Reports</h1>
      <p className="mb-5 text-sm text-slate-500">Daily, weekly, and monthly executive narratives with recommendations.</p>

      <QueryBoundary loading={q.loading} error={q.error} onRetry={q.reload}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <div className="divide-y divide-edge rounded-xl border border-edge bg-panel">
              {reports.map((r) => (
                <button key={r.id} onClick={() => setSelectedId(r.id)}
                  className={`block w-full px-3 py-2 text-left text-sm ${selected?.id === r.id ? 'bg-edge text-slate-100' : 'text-slate-300 hover:bg-edge/50'}`}>
                  <div className="font-medium capitalize">{r.report_type} report</div>
                  <div className="text-[11px] text-slate-500">{r.period_start} → {r.period_end}</div>
                </button>
              ))}
              {!reports.length && <div className="p-6 text-sm text-slate-500">No reports yet (run report-generate).</div>}
            </div>
          </div>
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-edge bg-panel p-4">
              {selected
                ? <pre className="whitespace-pre-wrap font-sans text-sm text-slate-200">{selected.narrative_md}</pre>
                : <div className="text-sm text-slate-500">Select a report.</div>}
            </div>
          </div>
        </div>
      </QueryBoundary>
    </div>
  );
}
