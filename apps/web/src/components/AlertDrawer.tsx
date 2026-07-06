import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Alert, AlertNote, RevealedContent } from '../lib/types';
import { SeverityBadge } from './SeverityBadge';
import { useAuth } from '../lib/auth';
import { useToast } from './Toast';
import { useSupabaseQuery } from '../lib/useSupabaseQuery';
import { addAlertNote, assignAlert, revealContent, setAlertStatus } from '../lib/mutations';

/**
 * Alert investigation drawer — the triage surface for the security-analyst
 * persona. Renders the evidence the list never showed (evidence_json, occurrence
 * counts, source pointers), an audited content-reveal flow, assignment, notes,
 * and triage actions.
 */
export function AlertDrawer({ alert, onClose, onChanged }: {
  alert: Alert; onClose: () => void; onChanged: () => void;
}) {
  const { hasRole, appUserId } = useAuth();
  const { reportError, notify } = useToast();
  const canSeeContent = hasRole(['ceo', 'admin']);
  const canTriage = hasRole(['ceo', 'admin', 'security_analyst']);

  const notesQ = useSupabaseQuery<AlertNote[]>(
    () => supabase.from('alert_notes').select('*').eq('alert_id', alert.id).order('created_at', { ascending: true }),
    [alert.id],
  );
  const [noteDraft, setNoteDraft] = useState('');
  const [revealOpen, setRevealOpen] = useState(false);
  const [justification, setJustification] = useState('');
  const [revealed, setRevealed] = useState<RevealedContent | null>(null);
  const [busy, setBusy] = useState(false);

  const isEmailEvidence = alert.source_event_table === 'email_events' && alert.source_event_id;

  async function triage(status: 'ack' | 'resolved' | 'false_positive') {
    if (reportError(await setAlertStatus(alert.id, status), 'Updated.')) onChanged();
  }
  async function assignToMe() {
    if (!appUserId) { notify('Your operator identity is not linked yet.', 'error'); return; }
    if (reportError(await assignAlert(alert.id, appUserId), 'Assigned to you.')) onChanged();
  }
  async function unassign() {
    if (reportError(await assignAlert(alert.id, null), 'Unassigned.')) onChanged();
  }
  async function submitNote() {
    if (!appUserId || !noteDraft.trim()) return;
    setBusy(true);
    const ok = reportError(await addAlertNote(alert.id, appUserId, noteDraft.trim()), 'Note added.');
    setBusy(false);
    if (ok) { setNoteDraft(''); notesQ.reload(); }
  }
  async function doReveal() {
    if (!alert.source_event_id) return;
    setBusy(true);
    const res = await revealContent(alert.source_event_id, justification);
    setBusy(false);
    if (res.error) { notify(res.error, 'error'); return; }
    setRevealed(res.data);
    setRevealOpen(false);
    setJustification('');
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto border-l border-edge bg-ink p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <SeverityBadge severity={alert.severity} />
            <span className="text-xs text-slate-400">{alert.alert_type}</span>
          </div>
          <button onClick={onClose} className="rounded border border-edge px-2 py-0.5 text-xs text-slate-400 hover:bg-edge">Close</button>
        </div>

        <h2 className="text-lg font-semibold text-slate-100">{alert.title}</h2>
        {alert.summary && <p className="mt-1 text-sm text-slate-400">{alert.summary}</p>}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span>status: <span className="text-slate-300">{alert.status}</span></span>
          <span>×{alert.occurrence_count}</span>
          <span>first: {new Date(alert.first_seen_at).toLocaleString()}</span>
          <span>last: {new Date(alert.last_seen_at).toLocaleString()}</span>
          {alert.employee_id && <Link to={`/employees/${alert.employee_id}`} className="text-sky-300 hover:underline">employee ↗</Link>}
        </div>

        {canTriage && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => triage('ack')} className="rounded border border-edge px-2 py-1 text-xs text-slate-200 hover:bg-edge">Acknowledge</button>
            <button onClick={() => triage('resolved')} className="rounded border border-edge px-2 py-1 text-xs text-emerald-300 hover:bg-edge">Resolve</button>
            <button onClick={() => triage('false_positive')} className="rounded border border-edge px-2 py-1 text-xs text-slate-400 hover:bg-edge">False positive</button>
            <button onClick={assignToMe} className="rounded border border-edge px-2 py-1 text-xs text-sky-300 hover:bg-edge">Assign to me</button>
            {alert.assigned_to && <button onClick={unassign} className="rounded border border-edge px-2 py-1 text-xs text-slate-400 hover:bg-edge">Unassign</button>}
          </div>
        )}

        {/* Evidence */}
        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Evidence</div>
          <pre className="overflow-x-auto rounded-lg border border-edge bg-panel p-3 text-xs text-slate-300">
            {JSON.stringify(alert.evidence_json ?? {}, null, 2)}
          </pre>
          {alert.source_event_table && (
            <div className="mt-1 text-[11px] text-slate-500">source: {alert.source_event_table} · {alert.source_event_id}</div>
          )}
        </div>

        {/* Audited content reveal */}
        {isEmailEvidence && (
          <div className="mt-4">
            {canSeeContent ? (
              <>
                {!revealed && !revealOpen && (
                  <button onClick={() => setRevealOpen(true)} className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20">
                    Reveal source email content…
                  </button>
                )}
                {revealOpen && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                    <div className="mb-1 text-xs text-amber-200">This access is logged to the immutable audit trail. State your justification:</div>
                    <textarea value={justification} onChange={(e) => setJustification(e.target.value)}
                      className="mb-2 h-16 w-full rounded border border-edge bg-ink px-2 py-1 text-sm text-slate-100"
                      placeholder="e.g. Investigating DLP alert #… for suspected rate-sheet disclosure" />
                    <div className="flex gap-2">
                      <button disabled={busy || justification.trim().length < 3} onClick={doReveal}
                        className="rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">Reveal &amp; log</button>
                      <button onClick={() => { setRevealOpen(false); setJustification(''); }} className="rounded border border-edge px-3 py-1 text-xs text-slate-300 hover:bg-edge">Cancel</button>
                    </div>
                  </div>
                )}
                {revealed && (
                  <div className="rounded-lg border border-edge bg-panel p-3 text-sm">
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-amber-300">Revealed content (logged)</div>
                    <div className="text-slate-200"><span className="text-slate-500">Subject:</span> {revealed.subject ?? '—'}</div>
                    {revealed.snippet && <div className="mt-1 text-slate-300"><span className="text-slate-500">Snippet:</span> {revealed.snippet}</div>}
                    {revealed.body && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-slate-300">{revealed.body}</pre>}
                  </div>
                )}
              </>
            ) : (
              <div className="text-[11px] text-slate-500">Message content is restricted to CEO/admin roles (RLS-enforced).</div>
            )}
          </div>
        )}

        {/* Notes */}
        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Investigation notes</div>
          <div className="space-y-2">
            {(notesQ.data ?? []).map((n) => (
              <div key={n.id} className="rounded-lg border border-edge bg-panel p-2 text-sm text-slate-200">
                {n.note}
                <div className="mt-1 text-[11px] text-slate-500">{new Date(n.created_at).toLocaleString()}</div>
              </div>
            ))}
            {!(notesQ.data ?? []).length && <div className="text-xs text-slate-500">No notes yet.</div>}
          </div>
          {canTriage && (
            <div className="mt-2 flex gap-2">
              <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Add a note…" className="flex-1 rounded border border-edge bg-ink px-2 py-1 text-sm text-slate-100" />
              <button disabled={busy || !noteDraft.trim()} onClick={submitNote}
                className="rounded border border-edge px-3 py-1 text-xs text-slate-200 hover:bg-edge disabled:opacity-40">Add</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
