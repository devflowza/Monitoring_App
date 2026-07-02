import { useEffect, useState } from 'react';
import { supabase, isConfigured } from '../lib/supabase';
import type { Report } from '../lib/types';

export function Reports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<Report | null>(null);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => {
        const rows = (data ?? []) as Report[];
        setReports(rows);
        setSelected(rows[0] ?? null);
      });
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-100">Reports</h1>
      <p className="mb-5 text-sm text-slate-500">Daily, weekly, and monthly executive narratives with recommendations.</p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <div className="divide-y divide-edge rounded-xl border border-edge bg-panel">
            {reports.map((r) => (
              <button key={r.id} onClick={() => setSelected(r)}
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
    </div>
  );
}
