# Compliance pack

Sentinel monitors company-owned Google Workspace accounts for security, DLP, and
business-intelligence purposes. That is lawful, but **org-wide processing of full
email content** (the configuration this deployment uses) is "systematic
monitoring on a large scale" — in most jurisdictions a logistics firm operates in
(EU/UK GDPR, UAE PDPL, etc.) that triggers heightened obligations. This pack is
the paperwork that makes the deployment defensible.

## Go-live gate (enforced in software)
Full-content org-wide ingestion stays inert until **both** policy flags are true:

| Policy key | Meaning | Default |
|---|---|---|
| `notice_delivered` | Employees have received the monitoring notice | `false` |
| `monitoring_active` | Full-content ingestion is switched on | `false` |

Do not flip these until the steps below are complete. (`store_all_bodies` is a
separate, conservative-by-default flag — leave it `false` unless legal sign-off
explicitly accepts warehousing every mailbox.)

## Before go-live — checklist
1. **Lawful basis** — document it (legitimate interest + balancing test, or
   consent where required). See `dpia-checklist.md`.
2. **Employee notice** — deliver `employee-monitoring-notice.md` and record
   acknowledgement (`employees.monitoring_consent_at`).
3. **Acceptable Use Policy** — ensure the AUP states company systems are
   monitored. (`acceptable-use-policy.md` is a pointer/skeleton.)
4. **DPIA** — complete `dpia-checklist.md`; have it reviewed by legal/DPO.
5. **RBAC** — confirm only `ceo`/`admin` hold content-read roles; analysts and
   managers see metadata/aggregates only.
6. **Retention** — set `content_retention_days` / `metadata_retention_days` per
   `jurisdiction-config.md`.
7. **DSAR/erasure** — confirm the process in `dsar-runbook.md` works.

## Files
- `employee-monitoring-notice.md` — notice template to circulate.
- `acceptable-use-policy.md` — AUP pointer/skeleton.
- `dpia-checklist.md` — Data Protection Impact Assessment worksheet.
- `jurisdiction-config.md` — per-region rule/retention configuration.
- `dsar-runbook.md` — data-subject access & erasure procedure.

> This pack is operational guidance, not legal advice. Have counsel/your DPO
> review before activating monitoring.
