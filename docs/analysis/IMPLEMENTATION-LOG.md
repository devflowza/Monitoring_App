# Implementation log — acting on the improvement roadmap

Tracks work done against `docs/analysis/codebase-analysis-and-improvements.md`,
milestone by milestone. Item references (D#, A#, B#, …) point at that document.

Verification available in this environment: web app is fully typechecked + built
(`tsc --noEmit`, `vite build`); pure-logic edge modules (DLP engine) are exercised
under Node's type-stripping; edge functions are syntax/type-erasure checked
(Deno + Supabase CLIs are not installable here, so migrations and function runtime
are verified by review, not execution).

---

## Milestone 0 — Stop the bleeding  ✅

Launch-blockers and the cheapest trust fixes.

| Item | What shipped |
|------|--------------|
| **D1 / D8** (B1) | Fixed the forwarding-rule destructure crash in `ingest-email` that aborted email ingestion. Added `last_seen_at` + `NULLS NOT DISTINCT` dedup indexes on `forwarding_rules` and `file_permissions` (migration 0004), and converted both ingest paths to upserts. Gated `ingest-drive` on `monitoring_active`. |
| **D2** (F1) | Rewrote the DLP engine: strip the inline `(?i)` prefix and compile with the `i` flag, compile once per rule, and log (not swallow) invalid patterns. The three dead seed rules (customer_db/pii/credentials) now match. Added `validatePattern()`/`normalizeRegexSource()` for reuse by the Settings editor. Verified under Node (all previously-dead rules now match; benign text still clean). |
| **D3** (B3) | Added `_shared/authz.ts` shared-secret guard, wired into all 9 `Deno.serve` handlers. Migration 0004 revokes `PUBLIC` execute on `app_invoke_function` / `app_purge_expired` and teaches `app_invoke_function` to send the `x-sentinel-secret` header from Vault. Documented `EDGE_SHARED_SECRET` in `.env.example`. |
| **D7** (B7, part) | Migration 0004 replaces the NULLs-distinct unique keys with `NULLS NOT DISTINCT` unique indexes on `policies`, `dlp_rules(name)`, and `sla_rules(department_id, rule_type)`, so re-seeding can no longer duplicate policy/rule rows (which would have silently stalled monitoring). Added the `email_events` body_ref/content_class `CHECK` invariant. |
| **D5** (F3, part) | `analyze` no longer fails open: on Claude error/refusal the deterministic match is retained but severity is capped at `medium` and tagged `adjudication:'unavailable'`; low-confidence verdicts (below a new `dlp_confidence_min` policy) are capped at `low`; confidence/model/adjudication are stored in `evidence_json` for the triage UI. |
| **D9** (F2) | Prompt-injection hardening in `analyze`: employee-authored fields are fenced in `<untrusted_email>` tags and `DLP_SYSTEM` instructs the adjudicator to treat them as data and to weigh verdict-steering text as an evasion signal. |
| **D10 / D6** (D5) | `alert-dispatch` now pushes a minimal metadata envelope (type/severity/department/count/deep-link — no titles/summaries that carry PII), retries failed deliveries up to 5 ticks instead of marking failures as delivered, and wraps the WhatsApp send in try/catch so one network error can't abort the batch. Added `alert_channel_verbosity` policy + `APP_BASE_URL`. |
| **E4** | Added `useSupabaseQuery` (tri-state loading/error/data), a `ToastProvider`, and a `QueryBoundary`/`ErrorPanel`/`LoadingPanel`. Refit all 9 data routes + `AlertFeed` so a failed query renders a distinct error panel (not "No data"), and all mutations surface failures — including RLS-filtered zero-row updates — as toasts. `AlertFeed` also now handles realtime `UPDATE`s. |

---

## Milestone 1 — Make the core loop trustworthy  ✅

| Item | What shipped |
|------|--------------|
| **B5** | Migration 0005 adds `app_raise_alert(jsonb)` — a single `INSERT … ON CONFLICT DO UPDATE` that eliminates the check-then-insert dedup race and the lost occurrence-count increments; `raiseAlert` now calls it. Dispatch state moved from `evidence_json` into real columns (`dispatch_status`/`dispatch_attempts`/`dispatched_at`); `alert-dispatch` marks `sent` only on real success and retries `pending` up to 5 ticks. |
| **B4** | `job_runs` observability table + a `withRun()` wrapper (wraps `analyze`, `compute-metrics`, `score-risk`, `report-generate`, `alert-dispatch`; ingestion health continues to flow through `sync_state`). Added the missing `sync_state` SELECT policy and a `sources` UPDATE policy so connector health is finally readable and sources are togglable. |
| **A8 / E1** | Alert case management: `alert_notes` table + `assigned_to` column (migration 0005). New `AlertDrawer` turns the flat alert list into a triage surface — evidence JSON, occurrence/first/last-seen, source pointers, assignment, notes, and triage; the Security page gains status/severity/type filters + search, row-click drawer, and occurrence badges. |
| **D3 / E2** | Audited, justification-gated content reveal. Migration 0005 revokes blanket `SELECT` on `email_events` and grants only the non-body columns, then adds a SECURITY DEFINER `app_reveal_content(event_id, justification)` that writes a `view_content` audit row before returning the body. The drawer's "Reveal content" flow (ceo/admin) requires a justification and shows the logged content — closing the one-sided audit-of-auditors. |
| **E3** | New `/system` route: connector cards (mode, active toggle, last run + staleness badge, status, error detail) joined from `sources` + `sync_state`, a recent `job_runs` table, and a go-live checklist reading the three gate policies. Added to nav. |
| **F4** | DLP golden-set eval harness: `eval/fixtures.jsonl` (20 labelled freight emails: disclosures, benign, keyword-trap, and prompt-injection) + `eval_test.ts` asserting 100% pre-filter recall on disclosures/injections and bounded false positives on benign mail. Wired into CI alongside the existing `(?i)`-regression test. Verified under Node: recall 1.0, FP rate 0.14. |

---

## Milestone 2 — Deliver the promised value  ✅

| Item | What shipped |
|------|--------------|
| **C1** | `_shared/notify.ts` shared SMTP sender (alert-dispatch reuses it); `report-generate` now emails the finalized narrative, and migration 0006 adds the missing monthly + monthly-compliance cron schedules. Degraded input (a failed feed) now yields a `draft` with an explicit warning and no email — no more confident-empty "all clear". |
| **C2** | `generateStructuredReport()` (Opus + `json_schema`) returns a narrative plus prioritized, alert-linked recommendations stored in `recommendations_json`. The Reports page renders real Markdown (dependency-free, XSS-safe `Markdown` component), shows recommendation cards with drill-through to Security, and offers a `.md` download. |
| **C3** | `report-generate` accepts `{type, scope_type, scope_id, days}` and builds org/department/employee digests plus a governance digest for the `security` compliance report; migration 0006 adds a dept-scoped `reports` RLS policy and a role-gated `app_request_report` RPC so the UI can trigger generation without holding the edge secret (Generate control on the Reports page). |
| **A5 / C6** | `_shared/time/business-hours.ts` (tz-aware `businessMinutesBetween`, Node-validated); `compute-metrics` v2 clamps latency/age to business hours, implements the `followup` and `quotation_turnaround` rule types, and emits an SLA compliance scorecard (`sla_within/breach_count`, `sla_compliance_rate`). The Sla page gains a per-department scorecard. |
| **C5** | `compute-metrics` writes department + org rollups; migration 0007 adds `NULLS NOT DISTINCT` unique keys on `metrics_daily`/`risk_scores` (so org rows dedupe) plus B7 hot-path indexes. The Sla page now reads org-scope rows, fixing the previous triple-count. |
| **D2** | `is_monitored` is now enforced: `ingest-email` never stores an opted-out employee's body and `analyze` skips their mail entirely — making the DSAR erasure remedy real. (`ingest-drive`'s `monitoring_active` gate landed in M0.) |
| **D6** | `app_purge_expired` rewritten (migration 0008): jurisdiction-aware content TTL (per-employee override → global), coverage of every event/derived table + orphaned threads + `cron.job_run_details`, a `created_at` fallback for null `sent_at`, and a proper `retention_purge` audit action with per-table counts. |
| **D7** | DSAR tooling as audited SECURITY DEFINER functions: `app_dsar_export` (JSON document across ~8 subject-data tables) and `app_dsar_erase` (content redaction + attachment scrub + `is_monitored=false`), plus `app_set_monitored`. Surfaced on the employee page (ceo/admin): monitored toggle, DSAR export-to-JSON, and justification-gated erasure. |
