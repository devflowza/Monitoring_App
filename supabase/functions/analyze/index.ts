// analyze — the core intelligence loop (email DLP + external sharing + external
// auto-forwarding). SLA / productivity / risk run in their own scheduled
// functions (compute-metrics, score-risk).
//   1. DLP pre-filter (deterministic) over recent outbound/external email,
//      scanning subject + snippet + body + attachment names
//   2. escalate flagged candidates to Claude (haiku) for adjudication
//   3. data minimization: drop stored bodies for non-flagged messages unless
//      store_all_bodies; keep + audit bodies that became evidence
//   4. external-share / public-link detection over file_permissions
//   5. external auto-forwarding alerts over forwarding_rules
// All evidence is metadata-only; raised alerts are deduped.

import { adminClient, getPolicy } from '../_shared/db.ts';
import { scanDlp, type DlpRule } from '../_shared/dlp/engine.ts';
import { classify } from '../_shared/claude/index.ts';
import { raiseAlert, type Severity } from '../_shared/alerts.ts';
import { logContentFetch } from '../_shared/audit/index.ts';

const DLP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['discloses', 'confidence', 'rationale'],
  properties: {
    discloses: { type: 'boolean' },
    confidence: { type: 'number' },
    rationale: { type: 'string' },
  },
};

const DLP_SYSTEM =
  'You are a data-loss-prevention adjudicator for a logistics company. Given an ' +
  'outbound email going to an external recipient, decide whether it actually ' +
  'DISCLOSES confidential business data (pricing/rates, quotations, contracts, ' +
  'customer databases, or financial documents). Keyword presence alone is not ' +
  'disclosure. Respond strictly as JSON: {discloses, confidence (0-1), rationale}.';

function sev(weight: number, external: boolean): Severity {
  const base = weight + (external ? 15 : 0);
  if (base >= 90) return 'critical';
  if (base >= 70) return 'high';
  if (base >= 45) return 'medium';
  return 'low';
}

Deno.serve(async () => {
  const db = adminClient();
  const storeAllBodies = await getPolicy<boolean>(db, 'store_all_bodies', false);
  const { data: rules } = await db.from('dlp_rules').select('*').eq('is_active', true);
  const dlpRules = (rules ?? []) as DlpRule[];

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  // --- 1-3. DLP over recent outbound email to external recipients ----------
  const { data: emails } = await db.from('email_events')
    .select('id, subject, snippet, body_ref, content_class, owner_employee_id, owner_department_id, external_recipient_count, is_personal_account_contact')
    .eq('direction', 'outbound')
    .gt('external_recipient_count', 0)
    .gte('sent_at', since)
    .limit(500);

  let dlpAlerts = 0;
  for (const ev of emails ?? []) {
    const att = await db.from('attachments').select('filename').eq('email_event_id', ev.id);
    const hasBody = ev.content_class === 'content' && ev.body_ref;
    const matches = scanDlp(dlpRules, {
      subject: ev.subject, snippet: ev.snippet,
      body: hasBody ? ev.body_ref : null,
      attachmentNames: (att.data ?? []).map((a) => a.filename).filter(Boolean) as string[],
    });

    let flagged = false;
    if (matches.length) {
      const top = matches.sort((a, b) => b.severityWeight - a.severityWeight)[0];
      let confirmed = !top.requiresClaudeConfirm;
      let rationale = 'keyword/regex match';

      if (top.requiresClaudeConfirm) {
        if (hasBody) await logContentFetch(db, { targetTable: 'email_events', targetId: ev.id, reason: top.ruleId });
        const verdict = await classify<{ discloses: boolean; confidence: number; rationale: string }>({
          tier: 'haiku', system: DLP_SYSTEM, schema: DLP_SCHEMA,
          content: `Subject: ${ev.subject ?? ''}\nSnippet: ${ev.snippet ?? ''}\n` +
            (hasBody ? `Body (excerpt): ${String(ev.body_ref).slice(0, 4000)}\n` : '') +
            `Matched rule: ${top.name} (${top.category})\nExcerpt: ${top.excerpt}`,
        });
        confirmed = verdict.ok ? Boolean(verdict.data?.discloses) : true;
        rationale = verdict.ok ? (verdict.data?.rationale ?? rationale) : 'AI adjudication unavailable — deterministic match retained for review';
      }

      if (confirmed) {
        const severity = sev(top.severityWeight, ev.is_personal_account_contact);
        await raiseAlert(db, {
          alertType: ev.is_personal_account_contact ? 'personal_email' : 'dlp',
          severity,
          title: `Possible ${top.category} disclosure to external recipient`,
          summary: rationale,
          employeeId: ev.owner_employee_id, departmentId: ev.owner_department_id,
          sourceEventTable: 'email_events', sourceEventId: ev.id, ruleId: top.ruleId,
          evidence: { rule: top.name, category: top.category, matchedOn: top.matchedOn, externalRecipients: ev.external_recipient_count },
          dedupKey: `dlp:${ev.id}:${top.ruleId}`,
        });
        dlpAlerts++;
        flagged = true;
      }
    }

    // Data minimization: only flagged messages retain their stored body.
    if (ev.body_ref && !flagged && !storeAllBodies) {
      await db.from('email_events').update({ body_ref: null, content_class: 'metadata' }).eq('id', ev.id);
    }
  }

  // --- 4. External-share / public-link detection ---------------------------
  const { data: shares } = await db.from('file_permissions')
    .select('id, provider_file_id, file_name, grantee, is_public_link')
    .eq('is_external', true)
    .gte('detected_at', since)
    .limit(500);

  let shareAlerts = 0;
  for (const p of shares ?? []) {
    await raiseAlert(db, {
      alertType: p.is_public_link ? 'exfil' : 'external_share',
      severity: p.is_public_link ? 'high' : 'medium',
      title: p.is_public_link ? `File shared via public link: ${p.file_name ?? p.provider_file_id}` : `File shared externally: ${p.file_name ?? p.provider_file_id}`,
      summary: `Grantee: ${p.grantee ?? 'unknown'}`,
      sourceEventTable: 'file_permissions', sourceEventId: p.id,
      evidence: { file: p.file_name, grantee: p.grantee, publicLink: p.is_public_link },
      dedupKey: `share:${p.provider_file_id}:${p.grantee ?? 'public'}`,
    });
    shareAlerts++;
  }

  // --- 5. External auto-forwarding rules -----------------------------------
  const { data: fwds } = await db.from('forwarding_rules')
    .select('id, identity_id, destination')
    .eq('is_external_destination', true)
    .gte('detected_at', since)
    .limit(200);

  let fwdAlerts = 0;
  for (const f of fwds ?? []) {
    await raiseAlert(db, {
      alertType: 'forwarding_rule',
      severity: 'high',
      title: `Mailbox auto-forwards to an external address`,
      summary: `Destination: ${f.destination ?? 'external'}`,
      sourceEventTable: 'forwarding_rules', sourceEventId: f.id,
      evidence: { destination: f.destination },
      dedupKey: `fwd:${f.identity_id}:${f.destination}`,
    });
    fwdAlerts++;
  }

  return Response.json({ dlpAlerts, shareAlerts, fwdAlerts });
});
