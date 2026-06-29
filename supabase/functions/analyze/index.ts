// analyze — the core intelligence loop (MVP scope: Email DLP + external sharing).
//   1. DLP pre-filter (deterministic) over recent outbound/external email
//   2. escalate flagged candidates to Claude (haiku) for adjudication
//   3. external-share / public-link detection over file_permissions
//   4. raise deduped alerts with METADATA-ONLY evidence
//
// SLA, productivity, finance, and risk passes are added in later phases.

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
  const contentAllowed = await getPolicy<boolean>(db, 'monitoring_active', false);
  const { data: rules } = await db.from('dlp_rules').select('*').eq('is_active', true);
  const dlpRules = (rules ?? []) as DlpRule[];

  // --- 1+2. DLP over recent outbound email to external recipients ----------
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: emails } = await db.from('email_events')
    .select('id, subject, snippet, body_ref, owner_employee_id, owner_department_id, external_recipient_count, is_personal_account_contact')
    .eq('direction', 'outbound')
    .gt('external_recipient_count', 0)
    .gte('sent_at', since)
    .limit(500);

  let dlpAlerts = 0;
  for (const ev of emails ?? []) {
    const att = await db.from('attachments').select('filename').eq('email_event_id', ev.id);
    const matches = scanDlp(dlpRules, {
      subject: ev.subject, snippet: ev.snippet,
      attachmentNames: (att.data ?? []).map((a) => a.filename).filter(Boolean) as string[],
    });
    if (!matches.length) continue;

    const top = matches.sort((a, b) => b.severityWeight - a.severityWeight)[0];
    let confirmed = !top.requiresClaudeConfirm;
    let rationale = 'keyword/regex match';

    if (top.requiresClaudeConfirm) {
      // Content adjudication. Fetching/using body is a content access → audited.
      if (contentAllowed) await logContentFetch(db, { targetTable: 'email_events', targetId: ev.id, reason: top.ruleId });
      const verdict = await classify<{ discloses: boolean; confidence: number; rationale: string }>({
        tier: 'haiku', system: DLP_SYSTEM, schema: DLP_SCHEMA,
        content: `Subject: ${ev.subject ?? ''}\nSnippet: ${ev.snippet ?? ''}\nMatched rule: ${top.name} (${top.category})\nExcerpt: ${top.excerpt}`,
      });
      // Fail safe: on refusal/error, keep the deterministic match as a lower-severity flag.
      confirmed = verdict.ok ? Boolean(verdict.data?.discloses) : true;
      rationale = verdict.ok ? (verdict.data?.rationale ?? rationale) : 'AI adjudication unavailable — deterministic match retained for review';
    }
    if (!confirmed) continue;

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
  }

  // --- 3. External-share / public-link detection ---------------------------
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

  return Response.json({ dlpAlerts, shareAlerts });
});
