import { useEffect, useState } from 'react';
import { supabase, isConfigured } from '../lib/supabase';
import type { FinanceEvent } from '../lib/types';
import { StatCard } from '../components/StatCard';

export function Finance() {
  const [events, setEvents] = useState<FinanceEvent[]>([]);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.from('finance_events').select('*').order('due_at', { ascending: true }).limit(300)
      .then(({ data }) => setEvents((data ?? []) as FinanceEvent[]));
  }, []);

  const now = Date.now();
  const overdue = events.filter((e) => e.object_type === 'invoice' && !e.paid_at && e.due_at && new Date(e.due_at).getTime() < now);
  const outstanding = events.filter((e) => e.object_type === 'invoice' && !e.paid_at);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-100">Finance</h1>
      <p className="mb-5 text-sm text-slate-500">Invoicing, overdue payments, and suspicious financial activity (PayPal).</p>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label="Overdue invoices" value={overdue.length} tone={overdue.length ? 'danger' : 'ok'} />
        <StatCard label="Outstanding" value={outstanding.length} tone={outstanding.length ? 'warn' : 'ok'} />
        <StatCard label="Suspicious flagged" value={events.filter((e) => e.is_suspicious).length} tone={events.some((e) => e.is_suspicious) ? 'warn' : 'ok'} />
      </div>

      <div className="overflow-hidden rounded-xl border border-edge">
        <table className="w-full text-left text-sm">
          <thead className="bg-panel text-xs uppercase text-slate-400">
            <tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Counterparty</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Due</th></tr>
          </thead>
          <tbody className="divide-y divide-edge bg-panel/40">
            {events.map((e) => {
              const isOverdue = !e.paid_at && e.due_at && new Date(e.due_at).getTime() < now;
              return (
                <tr key={e.id}>
                  <td className="px-3 py-2 text-slate-300">{e.object_type}</td>
                  <td className="px-3 py-2 text-slate-100">{e.counterparty ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{e.amount != null ? `${e.amount} ${e.currency ?? ''}` : '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{e.status ?? '—'}</td>
                  <td className={`px-3 py-2 ${isOverdue ? 'text-red-400' : 'text-slate-500'}`}>{e.due_at ? new Date(e.due_at).toLocaleDateString() : '—'}</td>
                </tr>
              );
            })}
            {!events.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">No finance events yet (configure PayPal + run ingest-finance).</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
