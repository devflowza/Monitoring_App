// Shared email sender (extracted from alert-dispatch) so reports and alerts use
// one SMTP path. Returns false and logs (never throws) when unconfigured or on
// failure, so callers degrade cleanly.

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

export async function sendEmail(subject: string, body: string, opts?: { to?: string }): Promise<boolean> {
  const from = Deno.env.get('ALERT_FROM_EMAIL');
  const smtp = Deno.env.get('SMTP_URL');           // smtp(s)://user:pass@host:port
  const to = opts?.to ?? Deno.env.get('ALERT_EMAIL_TO') ?? from;
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
    console.error(`[notify] email send failed: ${String(e)}`);
    return false;
  }
}
