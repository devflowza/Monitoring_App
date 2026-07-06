// alert-dispatch — deliver high/critical alerts to the CEO/admins via email +
// WhatsApp. The in-app realtime feed needs no dispatch (alerts table is
// realtime-published); this handles the push channels.
//
// PRIVACY: pushed messages carry a MINIMAL METADATA envelope only — alert type,
// severity, department (never employee name), occurrence count, and a dashboard
// deep link. Titles/summaries (which can embed file names, grantee emails,
// forwarding destinations, and AI rationales) are NEVER pushed to WhatsApp.
// Email may include the title only when alert_channel_verbosity='summary'.
//
// DELIVERY: dispatch state lives in dedicated alert columns (dispatch_status /
// dispatch_attempts / dispatched_at). An alert is marked 'sent' only when a
// channel actually succeeded; failures stay 'pending' and are retried on later
// ticks up to MAX_DISPATCH_ATTEMPTS, then marked 'failed'.

import { adminClient, getPolicy, withRun } from '../_shared/db.ts';
import { guardRequest } from '../_shared/authz.ts';
import { sendEmail } from '../_shared/notify.ts';

const MAX_DISPATCH_ATTEMPTS = 5;

async function sendWhatsApp(text: string): Promise<boolean> {
  const token = Deno.env.get('WHATSAPP_TOKEN');
  const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const to = Deno.env.get('ALERT_WHATSAPP_TO');
  if (!token || !phoneId || !to) return false;        // not configured → skip
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    });
    return res.ok;
  } catch (e) {
    console.error(`[alert-dispatch] whatsapp send failed: ${String(e)}`);
    return false;
  }
}

Deno.serve(async (req) => {
  const denied = guardRequest(req);
  if (denied) return denied;
  const db = adminClient();

  const result = await withRun(db, 'alert-dispatch', async () => {
    const verbosity = await getPolicy<string>(db, 'alert_channel_verbosity', 'minimal');
    const baseUrl = Deno.env.get('APP_BASE_URL') ?? '';

    const { data: depts } = await db.from('departments').select('id, name');
    const deptName = new Map((depts ?? []).map((d) => [d.id as string, d.name as string]));

    // Retry pending only (sent/failed are terminal).
    const { data: alerts } = await db.from('alerts')
      .select('id, alert_type, severity, title, department_id, occurrence_count, dispatch_attempts')
      .in('severity', ['high', 'critical'])
      .eq('status', 'open')
      .eq('dispatch_status', 'pending')
      .limit(50);

    let dispatched = 0;
    let retried = 0;
    let failed = 0;
    for (const a of alerts ?? []) {
      const where = a.department_id ? (deptName.get(a.department_id as string) ?? 'a department') : 'org-wide';
      const count = Number(a.occurrence_count ?? 1);
      const link = baseUrl ? ` · ${baseUrl}/security?alert=${a.id}` : '';
      const minimal = `[${String(a.severity).toUpperCase()}] ${a.alert_type} · ${where}${count > 1 ? ` · ×${count}` : ''}${link}`;
      const emailBody = verbosity === 'summary' ? `${minimal}\n${a.title}` : minimal;

      const wa = a.severity === 'critical' ? await sendWhatsApp(minimal) : false;
      const em = await sendEmail(`Sentinel alert: ${a.alert_type} (${a.severity})`, emailBody);

      const delivered = em || wa;
      const attempts = Number(a.dispatch_attempts ?? 0) + 1;
      const giveUp = !delivered && attempts >= MAX_DISPATCH_ATTEMPTS;

      await db.from('alerts').update({
        dispatch_status: delivered ? 'sent' : giveUp ? 'failed' : 'pending',
        dispatch_attempts: attempts,
        dispatched_at: delivered ? new Date().toISOString() : null,
      }).eq('id', a.id);

      if (delivered) dispatched++;
      else if (giveUp) failed++;
      else retried++;
    }
    return { recordsProcessed: (alerts ?? []).length, detail: { dispatched, retried, failed } };
  });

  return Response.json(result.detail);
});
