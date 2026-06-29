export function StatCard({ label, value, sub, tone }: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'default' | 'danger' | 'warn' | 'ok';
}) {
  const accent =
    tone === 'danger' ? 'text-red-400'
    : tone === 'warn' ? 'text-yellow-300'
    : tone === 'ok' ? 'text-emerald-400'
    : 'text-slate-100';
  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-2 text-3xl font-bold ${accent}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
