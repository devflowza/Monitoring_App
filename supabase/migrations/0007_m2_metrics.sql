-- =============================================================================
-- Sentinel — 0007 Milestone-2: metrics rollups + hot-path indexes
--   * C5  org rollups need NULLS NOT DISTINCT keys (scope_id IS NULL = org),
--         otherwise the hourly upsert inserts duplicate org rows every run.
--   * B7  missing hot-path indexes for real query paths.
-- Re-runnable.
-- =============================================================================

-- Replace the NULLs-distinct unique keys so org rollups (scope_id NULL) dedupe.
do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'metrics_daily'::regclass and contype = 'u';
  if c is not null then execute format('alter table metrics_daily drop constraint %I', c); end if;
end $$;
create unique index if not exists metrics_daily_scope_uidx
  on metrics_daily (metric_date, scope_type, scope_id, metric_key) nulls not distinct;

do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'risk_scores'::regclass and contype = 'u';
  if c is not null then execute format('alter table risk_scores drop constraint %I', c); end if;
end $$;
create unique index if not exists risk_scores_scope_uidx
  on risk_scores (scope_type, scope_id, score_date) nulls not distinct;

-- B7 — hot-path indexes.
create index if not exists attachments_email_event_idx on attachments (email_event_id);
create index if not exists alerts_employee_idx on alerts (employee_id);
create index if not exists finance_events_open_due_idx on finance_events (object_type, due_at) where paid_at is null;
create index if not exists audit_log_occurred_idx on audit_log (occurred_at);
