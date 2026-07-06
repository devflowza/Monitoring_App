// alert-dispatch — deliver high/critical alerts to the CEO/admins via email +
// WhatsApp. The in-app realtime feed needs no dispatch (alerts table is
// realtime-published); this handles the push channels.
//
// PRIVACY: pushed messages carry a MINIMAL METADATA envelope only — alert type,
// severity, department (never employee name), occurrence count, and a dashboard
// deep link. Alert titles/summaries can embed file names, grantee emails,
// forwarding destinations, and AI rationales that paraphrase message content, so
// they are NEVER pushed to WhatsApp (an unmanaged consumer channel). Email may
// include the title only when alert_channel_verbosity='summary'.
//
// DELIVERY: an alert is marked dispatched only when a channel actually succeeded;
// failures are retried on subsequent 5-minute ticks up to MAX_DISPATCH_ATTEMPTS.

import { adminClient, getPolicy } from '../_shared/db.ts';
import { guardRequest } from '../_shared/authz.ts';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

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
    // A network throw must not abort the whole batch (email still needs to send).
    console.error(`[alert-dispatch] whatsapp send failed: ${String(e)}`);
    return false;
  }
}

async function sendEmail(subject: string, body: string): Promise<boolean> {
  const from = Deno.env.get('ALERT_FROM_EMAIL');
  const smtp = Deno.env.get('SMTP_URL');           // smtp(s)://user:pass@host:port
  const to = Deno.env.get('ALERT_EMAIL_TO') ?? from;
  if (!from || !smtp || !to) return false;          // not configured → skip cleanly
  try {
    const u = new URL(smtp);
    const client = new SMTPClient({
      connection: {
        hostname: u.hostname,
        port: Number(u.port || 587),
        tls: u.protocol === 'smtps:',
        auth: u.username
          ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }
          : undefined,
      },
    });
    await client.send({ from, to, subject, content: body });
    await client.close();
    return true;
  } catch (e) {
    console.error(`[alert-dispatch] email send failed: ${String(e)}`);
    return false;
  }
}

Deno.serve(async (req) => {
  const denied = guardRequest(req);
  if (denied) return denied;
  const db = adminClient();
  const verbosity = await getPolicy<string>(db, 'alert_channel_verbosity', 'minimal');
  const baseUrl = Deno.env.get('APP_BASE_URL') ?? '';

  const { data: depts } = await db.from('departments').select('id, name');
  const deptName = new Map((depts ?? []).map((d) => [d.id as string, d.name as string]));

  const { data: alerts } = await db.from('alerts')
    .select('id, alert_type, severity, title, department_id, occurrence_count, evidence_json')
    .in('severity', ['high', 'critical'])
    .eq('status', 'open')
    .limit(50);

  let dispatched = 0;
  let retried = 0;
  for (const a of alerts ?? []) {
    const evidence = (a.evidence_json ?? {}) as Record<string, unknown>;
    if (evidence.dispatched) continue;

    const where = a.department_id ? (deptName.get(a.department_id as string) ?? 'a department') : 'org-wide';
    const count = Number(a.occurrence_count ?? 1);
    const link = baseUrl ? ` · ${baseUrl}/security?alert=${a.id}` : '';
    // MINIMAL envelope — no title/summary (they can carry employee content/PII).
    const minimal = `[${String(a.severity).toUpperCase()}] ${a.alert_type} · ${where}${count > 1 ? ` · ×${count}` : ''}${link}`;
    // Email may be richer (title included) only in 'summary' mode.
    const emailBody = verbosity === 'summary' ? `${minimal}\n${a.title}` : minimal;

    const wa = a.severity === 'critical' ? await sendWhatsApp(minimal) : false;
    const em = await sendEmail(`Sentinel alert: ${a.alert_type} (${a.severity})`, emailBody);

    const delivered = em || wa;
    const attempts = Number(evidence.dispatch_attempts ?? 0) + 1;
    const giveUp = attempts >= MAX_DISPATCH_ATTEMPTS;

    await db.from('alerts').update({
      evidence_json: {
        ...evidence,
        dispatched: delivered || giveUp,
        dispatch_attempts: attempts,
        dispatch_failed: !delivered && giveUp,
        channels: { whatsapp: wa, email: em },
        last_dispatch_at: new Date().toISOString(),
      },
    }).eq('id', a.id);

    if (delivered) dispatched++;
    else if (!giveUp) retried++;
  }
  return Response.json({ dispatched, retried });
});
