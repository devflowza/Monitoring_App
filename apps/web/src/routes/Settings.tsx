import { useEffect, useMemo, useState } from 'react';
import { supabase, isConfigured } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { DlpRule, DlpRuleStat, Policy, RiskWeight, SlaRule } from '../lib/types';
import { setDlpRuleActive, setPolicyValue, setRiskWeight, setSlaThreshold } from '../lib/mutations';
import { useToast } from '../components/Toast';

function boolPolicy(policies: Policy[], key: string): boolean {
  return Boolean(policies.find((p) => p.policy_key === key)?.value_json?.value);
}
function listPolicy(policies: Policy[], key: string): string[] {
  const v = policies.find((p) => p.policy_key === key)?.value_json?.value;
  return Array.isArray(v) ? (v as string[]) : [];
}

export function Settings() {
  const { hasRole } = useAuth();
  const { notify, reportError } = useToast();
  const canWrite = hasRole(['ceo', 'admin']);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [dlp, setDlp] = useState<DlpRule[]>([]);
  const [sla, setSla] = useState<SlaRule[]>([]);
  const [weights, setWeights] = useState<RiskWeight[]>([]);
  const [stats, setStats] = useState<DlpRuleStat[]>([]);
  const [competitorDraft, setCompetitorDraft] = useState<string | null>(null);

  async function load() {
    if (!isConfigured) return;
    const [p, d, s, w, rs] = await Promise.all([
      supabase.from('policies').select('policy_key, value_json'),
      supabase.from('dlp_rules').select('*').order('category'),
      supabase.from('sla_rules').select('*').order('rule_type'),
      supabase.from('risk_weights').select('*').order('factor_key'),
      supabase.from('dlp_rule_stats').select('*'),
    ]);
    setPolicies((p.data ?? []) as Policy[]);
    setDlp((d.data ?? []) as DlpRule[]);
    setSla((s.data ?? []) as SlaRule[]);
    setWeights((w.data ?? []) as RiskWeight[]);
    setStats((rs.data ?? []) as DlpRuleStat[]);
  }
  useEffect(() => { load(); }, []);

  const statByRule = useMemo(() => new Map(stats.map((s) => [s.rule_id, s])), [stats]);
  const competitorDomains = listPolicy(policies, 'competitor_domains');

  async function saveCompetitorDomains() {
    const list = (competitorDraft ?? '').split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (reportError(await setPolicyValue('competitor_domains', list), 'Competitor domains saved.')) {
      setCompetitorDraft(null); await load();
    }
  }

  const monitoringActive = boolPolicy(policies, 'monitoring_active');
  const noticeDelivered = boolPolicy(policies, 'notice_delivered');
  const storeAllBodies = boolPolicy(policies, 'store_all_bodies');

  async function toggleGate(key: string, next: boolean) {
    if (key === 'monitoring_active' && next && !noticeDelivered) {
      notify('Cannot activate monitoring: employee notice + DPIA must be recorded first (set "Notice delivered").', 'error');
      return;
    }
    if (reportError(await setPolicyValue(key, next), 'Saved.')) await load();
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-100">Settings</h1>
      <p className="mb-5 text-sm text-slate-500">
        {canWrite ? 'Configure detection, scoring, and the compliance gates.' : 'Read-only — configuration is restricted to CEO/admin roles.'}
      </p>

      {/* Compliance gates */}
      <section className="mb-8 rounded-xl border border-edge bg-panel p-4">
        <div className="mb-3 text-sm font-semibold text-slate-200">Compliance gates</div>
        <p className="mb-4 text-xs text-slate-500">
          Org-wide, full-content collection stays inert until both notice is delivered (DPIA on file) and monitoring is active. This enforces notice-before-collection.
        </p>
        {[
          { key: 'notice_delivered', label: 'Notice delivered (employee notice + DPIA recorded)', val: noticeDelivered },
          { key: 'monitoring_active', label: 'Monitoring active (real org-wide ingestion ON)', val: monitoringActive },
          { key: 'store_all_bodies', label: 'Store all message bodies (off = flagged-only, recommended)', val: storeAllBodies },
        ].map((g) => (
          <label key={g.key} className="mb-2 flex items-center justify-between gap-4 rounded-lg border border-edge bg-ink px-3 py-2">
            <span className="text-sm text-slate-200">{g.label}</span>
            <input type="checkbox" checked={g.val} disabled={!canWrite}
              onChange={(e) => toggleGate(g.key, e.target.checked)} />
          </label>
        ))}
      </section>

      {/* Competitor domains */}
      <section className="mb-8 rounded-xl border border-edge bg-panel p-4">
        <div className="mb-2 text-sm font-semibold text-slate-200">Competitor domains</div>
        <p className="mb-2 text-xs text-slate-500">Outbound email to these domains raises a competitor-contact alert (critical when it also discloses data). Comma- or space-separated.</p>
        <div className="flex gap-2">
          <input
            value={competitorDraft ?? competitorDomains.join(', ')}
            onChange={(e) => setCompetitorDraft(e.target.value)}
            disabled={!canWrite}
            placeholder="rivalforwarder.com, competitor-logistics.ae"
            className="flex-1 rounded border border-edge bg-ink px-2 py-1 text-sm text-slate-100"
          />
          <button disabled={!canWrite || competitorDraft === null} onClick={saveCompetitorDomains}
            className="rounded border border-edge px-3 py-1 text-xs text-slate-200 hover:bg-edge disabled:opacity-40">Save</button>
        </div>
      </section>

      {/* DLP rules */}
      <section className="mb-8">
        <div className="mb-2 text-sm font-semibold text-slate-200">DLP rules</div>
        <div className="overflow-hidden rounded-xl border border-edge">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Name</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Weight</th>
                <th className="px-3 py-2">Fired</th><th className="px-3 py-2">FP rate</th><th className="px-3 py-2">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge bg-panel/40">
              {dlp.map((r) => {
                const st = statByRule.get(r.id);
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-slate-100">{r.name}</td>
                    <td className="px-3 py-2 text-slate-400">{r.category}</td>
                    <td className="px-3 py-2 text-slate-400">{r.severity_weight}</td>
                    <td className="px-3 py-2 text-slate-400">{st?.fired ?? 0}</td>
                    <td className={`px-3 py-2 ${(st?.fp_rate ?? 0) > 0.5 ? 'text-red-400' : 'text-slate-400'}`}>{st ? `${Math.round(st.fp_rate * 100)}%` : '—'}</td>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={r.is_active} disabled={!canWrite}
                        onChange={async (e) => { if (reportError(await setDlpRuleActive(r.id, e.target.checked), 'Saved.')) await load(); }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Risk weights + SLA thresholds */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <EditableList title="Risk weights" canWrite={canWrite}
          rows={weights.map((w) => ({ id: w.id, label: w.factor_key, value: w.weight }))}
          onSave={async (id, v) => { if (reportError(await setRiskWeight(id, v), 'Saved.')) await load(); }} step={0.5} />
        <EditableList title="SLA thresholds (minutes)" canWrite={canWrite}
          rows={sla.map((s) => ({ id: s.id, label: s.rule_type, value: s.threshold_minutes }))}
          onSave={async (id, v) => { if (reportError(await setSlaThreshold(id, Math.round(v)), 'Saved.')) await load(); }} step={30} />
      </div>
    </div>
  );
}

function EditableList({ title, rows, canWrite, onSave, step }: {
  title: string; canWrite: boolean; step: number;
  rows: Array<{ id: string; label: string; value: number }>;
  onSave: (id: string, value: number) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, number>>({});
  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <div className="mb-3 text-sm font-semibold text-slate-200">{title}</div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm text-slate-300">{r.label}</span>
            <input type="number" step={step} defaultValue={r.value} disabled={!canWrite}
              onChange={(e) => setDraft((d) => ({ ...d, [r.id]: Number(e.target.value) }))}
              className="w-24 rounded border border-edge bg-ink px-2 py-1 text-sm text-slate-100" />
            <button disabled={!canWrite || draft[r.id] === undefined}
              onClick={() => onSave(r.id, draft[r.id])}
              className="rounded border border-edge px-2 py-1 text-xs text-slate-300 hover:bg-edge disabled:opacity-40">Save</button>
          </div>
        ))}
      </div>
    </section>
  );
}
