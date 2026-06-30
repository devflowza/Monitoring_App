# Sentinel — Monitoring, Compliance & BI Platform

Internal **monitoring, compliance, and business-intelligence** platform for **Vision Freights LLC**, operating over company-owned **Google Workspace** accounts. It ingests organizational activity (email, Drive, Calendar, finance), detects data-leak / SLA / security risk, scores risk per employee & department, fires email + WhatsApp + in-app alerts, and produces executive reports with actionable recommendations.

This is a lawful **employer-monitoring / DLP / BI** system in the same category as Google Vault, Microsoft Purview, and Proofpoint. It is built **compliance-by-design** — data minimization, RBAC, an immutable audit-of-the-watchers log, retention controls, and a notice/DPIA gate are first-class, not optional.

> ⚠️ **Before going live:** org-wide full-content processing must not be activated until employee notice and a DPIA are completed. The system enforces this with a `monitoring_active` policy flag (default **off**). See [`docs/compliance/`](docs/compliance/).

---

## Architecture

```
Google Workspace (Admin SDK / Gmail / Drive / Calendar) ┐
PayPal ────────────────────────────────────────────────┤→ connectors → evt_* tables (normalized, append-only)
                                                         │      │
                                  analyze (SQL + Claude) ←┘      ↓
                                         │            metrics_daily / risk_scores
                                         ↓                    │
                              alerts (deduped) → alert-dispatch → Email + WhatsApp + Realtime feed
                                         │                                      │
                                  report-generate (Opus narrative → PDF)   React dashboard (RBAC-gated)
```

- **Backend / DB:** Supabase Postgres — RLS, `pg_cron`, Realtime, Vault, Edge Functions (Deno/TS).
- **Intelligence:** Anthropic Claude — tiered (`claude-haiku-4-5` classification, `claude-sonnet-4-6` summaries, `claude-opus-4-8` reports & deep synthesis).
- **Frontend:** React + Vite + TypeScript + Tailwind + Recharts; Supabase Realtime for the live incident feed.
- **Ingestion:** Google Admin SDK Reports API + Gmail API (domain-wide delegation), Drive permissions/activity, Calendar, PayPal.

### The connector abstraction
A single `SourceConnector` interface (`supabase/functions/_shared/connectors/types.ts`) normalizes every source into common `NormalizedRecord` DTOs. Two implementations sit behind it — `google_admin` (org-wide, production) and `mcp` (single-account, dev/test) — emitting **identical** shapes. Analysis, scoring, alerting, and the dashboard read only from normalized Postgres tables, so swapping dev↔org-wide is a config change, not a rewrite.

---

## Repository layout

```
apps/web/                  React + Vite dashboard (executive, security, sla, finance, productivity, reports, settings)
supabase/
  migrations/              Numbered SQL — schema, RLS, audit trigger, seed
  functions/
    _shared/               connectors/ (interface + adapters), claude/, dlp/, risk/, audit/
    ingest-email/  ingest-drive/  ingest-calendar/  ingest-finance/
    analyze/  score-risk/  alert-dispatch/  report-generate/
packages/shared/           zod schemas & enums shared web ↔ functions
docs/compliance/           monitoring notice, DPIA checklist, AUP, jurisdiction config, DSAR runbook
docs/runbooks/             Google Workspace domain-wide-delegation setup, ops
```

---

## Status & roadmap

| Phase | Scope | State |
|---|---|---|
| **0 — Foundations** | Schema + RLS + audit spine, connector interface, compliance docs, frontend scaffold | **In progress** |
| **1 — MVP** | Email Intelligence + DLP: ingest → analyze (full-content) → alerts (email/WhatsApp/in-app) → executive & security dashboard | Next |
| 2 | Sales/Ops SLA, productivity, transparent risk scoring, daily/weekly reports | Planned |
| 3 | PayPal finance, insider-threat synthesis, login/device anomalies, monthly compliance report, 3D risk map | Planned |

The full plan lives in the approved design doc; this README tracks the build.

---

## Getting started (developer)

> Org-wide ingestion needs the Google service account from [`docs/runbooks/google-workspace-setup.md`](docs/runbooks/google-workspace-setup.md). The pipeline is developed and tested against the admin mailbox first; no Google credentials are required to run the dashboard locally.

```bash
npm install                      # install workspace deps
cp .env.example apps/web/.env.local   # set VITE_SUPABASE_URL + anon key
npm run dev                      # start the dashboard (apps/web)
npm run build                    # production build (shared + web)
```

Supabase (applied via the Supabase MCP tools or the CLI):

```bash
# migrations live in supabase/migrations/ — apply 0001_init_schema.sql, then 0002_seed.sql
# edge functions live in supabase/functions/ — deploy individually
# after each migration, run the security advisors to catch missing-RLS lints
```

### Required secrets (Supabase Vault — never committed)
`ANTHROPIC_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_ADMIN_IMPERSONATE_EMAIL`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `ALERT_FROM_EMAIL`. See [`.env.example`](.env.example).

---

## Compliance

Monitoring company communications is lawful but regulated. This platform ships the controls and documents needed to do it defensibly:

- **RBAC** — only `ceo`/`admin` roles can read message content; managers are scoped to their department.
- **Audit-of-auditors** — every content view, export, and policy change is written to an immutable `audit_log`.
- **Data minimization** — metadata-first; raw email bodies stored only when a policy flags a message (default).
- **Retention** — per-content-class TTLs purged nightly.
- **Notice / DPIA gate** — `monitoring_active` defaults off until notice + DPIA are recorded.

See [`docs/compliance/`](docs/compliance/) for the notice template, DPIA checklist, and jurisdiction configuration.
