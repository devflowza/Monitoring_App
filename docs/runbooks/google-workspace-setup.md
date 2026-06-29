# Runbook: Org-wide Google Workspace access (service account + domain-wide delegation)

Sentinel reaches every employee's mailbox/Drive read-only through a Google Cloud
**service account** with **domain-wide delegation (DWD)**. This is a one-time
setup only a Workspace **Super Admin** can perform. The application code is
already written against these scopes — once the credentials are in Vault, flip
the relevant `sources.mode` to `google_admin` and ingestion goes org-wide.

> Read-only by design. Every scope below is a `*.readonly` scope. Sentinel never
> needs write access to employee mail or files.

## 1. Create a Google Cloud project & enable APIs
1. Go to <https://console.cloud.google.com> → create a project (e.g. `vf-sentinel`).
2. **APIs & Services → Enable APIs** and enable:
   - Admin SDK API
   - Gmail API
   - Google Drive API + Drive Activity API
   - Google Calendar API

## 2. Create the service account + key
1. **IAM & Admin → Service Accounts → Create service account** (e.g. `sentinel-ingest`).
2. Skip role grants (DWD is authorized in the Admin console, not via IAM roles).
3. Open the service account → **Keys → Add key → JSON**. Download the JSON.
4. Note the service account's **Client ID** (a long number) — needed in step 3.

## 3. Authorize domain-wide delegation (Admin console)
1. Go to <https://admin.google.com> → **Security → Access and data control → API controls → Domain-wide delegation**.
2. **Add new**. Paste the service account **Client ID**.
3. Paste these scopes (comma-separated), then **Authorize**:
   ```
   https://www.googleapis.com/auth/admin.reports.audit.readonly,
   https://www.googleapis.com/auth/gmail.readonly,
   https://www.googleapis.com/auth/drive.metadata.readonly,
   https://www.googleapis.com/auth/drive.activity.readonly,
   https://www.googleapis.com/auth/calendar.readonly,
   https://www.googleapis.com/auth/admin.directory.user.readonly
   ```

## 4. Store the credentials in Supabase Vault (never in git)
Set these as Edge Function secrets (`supabase secrets set ...` or the dashboard):
- `GOOGLE_SERVICE_ACCOUNT_JSON` — the full JSON key from step 2 (raw or base64).
- `GOOGLE_ADMIN_IMPERSONATE_EMAIL` — a Super Admin address to impersonate for
  the Admin SDK Reports API (e.g. `md@visionfreights.com`).
- `ANTHROPIC_API_KEY` — for the AI analysis layer.
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `ALERT_WHATSAPP_TO` — WhatsApp alerts.
- `ALERT_FROM_EMAIL` (+ `SMTP_URL` for production email).

## 5. Switch ingestion to org-wide
Once secrets are set and **employee notice + DPIA are complete** (see
`docs/compliance/`), enable the go-live gate and flip the sources:
```sql
update policies set value_json = '{"value": true}' where policy_key = 'notice_delivered';
update policies set value_json = '{"value": true}' where policy_key = 'monitoring_active';
update sources set mode = 'google_admin' where kind in ('gmail','drive','calendar');
```
The connector factory now returns the `google_admin` adapters; the next `pg_cron`
tick ingests org-wide. No analysis/dashboard changes are required.

## 6. Verify
- Trigger `ingest-email` once; confirm `email_events` populate and `sync_state`
  advances (`last_status = 'ok'`).
- Trigger `ingest-drive`; confirm external shares land in `file_permissions`.
- Run `analyze`; confirm alerts appear in the dashboard's live feed.

## Troubleshooting
- **401 `unauthorized_client`** — the Client ID/scopes in step 3 don't match, or
  DWD hasn't propagated (allow a few minutes).
- **403 on Admin SDK** — `GOOGLE_ADMIN_IMPERSONATE_EMAIL` is not a Super Admin.
- **Empty mailbox results** — the impersonated user has no matching messages in
  the sync window, or the scope wasn't authorized.
