// alert-dispatch — deliver high/critical alerts to the CEO/admins via email +
// WhatsApp. The in-app realtime feed needs no dispatch (alerts table is
// realtime-published); this handles the push channels. Messages carry METADATA
// ONLY — never raw flagged content. Invoked by pg_cron every few minutes.
//
// Dedup: an alert is dispatched once (evidence_json.dispatched flag). Lower
// severities roll into the digest reports instead of paging the CEO.

import { adminClient } from '../_shared/db.ts';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

async function sendWhatsApp(text: string): Promise<boolean> {
  const token = Deno.env.get('WHATSAPP_TOKEN');
  const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const to = Deno.env.get('ALERT_WHATSAPP_TO');
  if (!token || !phoneId || !to) return false;        // not configured → skip
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  });
  return res.ok;
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
  } catch (_e) {
    return false;
  }
}

Deno.serve(async () => {
  const db = adminClient();
  const { data: alerts } = await db.from('alerts')
    .select('id, alert_type, severity, title, summary, evidence_json')
    .in('severity', ['high', 'critical'])
    .eq('status', 'open')
    .limit(50);

  let dispatched = 0;
  for (const a of alerts ?? []) {
    if ((a.evidence_json as Record<string, unknown>)?.dispatched) continue;
    const line = `[${String(a.severity).toUpperCase()}] ${a.title}${a.summary ? ` — ${a.summary}` : ''}`;
    const wa = a.severity === 'critical' ? await sendWhatsApp(line) : false;
    const em = await sendEmail(`Sentinel alert: ${a.title}`, line);

    await db.from('alerts').update({
      evidence_json: { ...(a.evidence_json as Record<string, unknown>), dispatched: true, channels: { whatsapp: wa, email: em } },
    }).eq('id', a.id);
    dispatched++;
  }
  return Response.json({ dispatched });
});
