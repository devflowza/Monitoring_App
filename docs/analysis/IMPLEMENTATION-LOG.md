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
