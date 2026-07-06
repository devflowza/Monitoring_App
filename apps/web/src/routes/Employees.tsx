import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { RiskScore } from '../lib/types';
import { useSupabaseQuery } from '../lib/useSupabaseQuery';
import { QueryBoundary } from '../components/QueryState';

interface Row { id: string; name: string; score: number; tier: string; trend: number | null; }

const TIER_STYLE: Record<string, string> = {
  critical: 'text-red-400', high: 'text-orange-400', elevated: 'text-yellow-300', low: 'text-emerald-400',
};

export function Employees() {
  const q = useSupabaseQuery<Row[]>(async () => {
    const scoresRes = await supabase.from('risk_scores').select('*')
      .eq('scope_type', 'employee').order('score_date', { ascending: false }).limit(500);
    if (scoresRes.error) return { data: null, error: scoresRes.error };
    const latest = new Map<string, RiskScore>();
    for (const s of (scoresRes.data ?? []) as RiskScore[]) if (s.scope_id && !latest.has(s.scope_id)) latest.set(s.scope_id, s);
    const empsRes = await supabase.from('employees').select('id, full_name').limit(2000);
    if (empsRes.error) return { data: null, error: empsRes.error };
    const nameById = new Map((empsRes.data ?? []).map((e: { id: string; full_name: string }) => [e.id, e.full_name]));
    const rows = [...latest.values()]
      .map((s) => ({ id: s.scope_id as string, name: nameById.get(s.scope_id as string) ?? s.scope_id as string, score: s.total_score, tier: s.tier, trend: s.trend_vs_prev }))
      .sort((a, b) => b.score - a.score);
    return { data: rows, error: null };
  }, []);

  const rows = q.data ?? [];

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-100">High-risk employees</h1>
      <p className="mb-5 text-sm text-slate-500">Composite risk (baseline-adjusted), highest first. Click for the breakdown.</p>

      <QueryBoundary loading={q.loading} error={q.error} onRetry={q.reload}>
        <div className="overflow-hidden rounded-xl border border-edge">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel text-xs uppercase text-slate-400">
              <tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Risk</th><th className="px-3 py-2">Tier</th><th className="px-3 py-2">Trend</th></tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel/40">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2"><Link to={`/employees/${r.id}`} className="text-sky-300 hover:underline">{r.name}</Link></td>
                  <td className="px-3 py-2 font-semibold text-slate-100">{r.score}</td>
                  <td className={`px-3 py-2 font-medium uppercase ${TIER_STYLE[r.tier] ?? 'text-slate-300'}`}>{r.tier}</td>
                  <td className="px-3 py-2 text-slate-400">{r.trend == null ? '—' : r.trend > 0 ? `▲ ${r.trend}` : r.trend < 0 ? `▼ ${Math.abs(r.trend)}` : '0'}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-500">No risk scores yet (run score-risk).</td></tr>}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
    </div>
  );
}
