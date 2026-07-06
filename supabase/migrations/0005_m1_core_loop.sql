-- =============================================================================
-- Sentinel — 0005 Milestone-1: trustworthy core loop
--   * B5  atomic alert dedup RPC + dispatch state columns
--   * B4  job_runs observability table + sync_state read policy + sources toggle
--   * A8  alert case management: alert_notes + assigned_to
--   * D3/E2  audited, justification-gated content reveal (column privilege gate
--           on email_events + a SECURITY DEFINER reveal RPC)
-- Re-runnable.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- B5 — atomic alerting
-- ----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'alert_dispatch_status') then
    create type alert_dispatch_status as enum ('pending', 'sent', 'failed');
  end if;
end $$;

alter table alerts add column if not exists dispatch_status  alert_dispatch_status not null default 'pending';
alter table alerts add column if not exists dispatch_attempts int not null default 0;
alter table alerts add column if not exists dispatched_at    timestamptz;
alter table alerts add column if not exists assigned_to      uuid references app_users(id) on delete set null;
create index if not exists alerts_dispatch_idx on alerts (dispatch_status, severity) where status = 'open';

-- Single-statement upsert-or-increment: eliminates the check-then-insert race
-- (the loser previously violated unique(dedup_key) and was silently dropped) and
-- the non-atomic occurrence_count read-modify-write (lost increments).
create or replace function public.app_raise_alert(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into alerts (
    alert_type, severity, status, employee_id, department_id,
    source_event_table, source_event_id, rule_id, title, summary,
    evidence_json, dedup_key, first_seen_at, last_seen_at
  ) values (
    (p->>'alert_type')::alert_type,
    coalesce((p->>'severity')::alert_severity, 'medium'),
    'open',
    nullif(p->>'employee_id', '')::uuid,
    nullif(p->>'department_id', '')::uuid,
    p->>'source_event_table',
    nullif(p->>'source_event_id', '')::uuid,
    nullif(p->>'rule_id', '')::uuid,
    p->>'title',
    p->>'summary',
    coalesce(p->'evidence', '{}'::jsonb),
    p->>'dedup_key',
    now(), now()
  )
  on conflict (dedup_key) do update
    set occurrence_count = alerts.occurrence_count + 1,
        last_seen_at = now()
  returning id into v_id;
  return v_id;
end; $$;

-- Only the service role (edge functions) may raise alerts; clients cannot forge them.
revoke execute on function public.app_raise_alert(jsonb) from public;
grant  execute on function public.app_raise_alert(jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- B4 — observability
-- ----------------------------------------------------------------------------
create table if not exists job_runs (
  id                uuid primary key default gen_random_uuid(),
  function_name     text not null,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  status            text not null default 'running',   -- running | ok | error
  records_processed int,
  alerts_raised     int,
  detail            jsonb not null default '{}'::jsonb,
  error_detail      text
);
create index if not exists job_runs_fn_started_idx on job_runs (function_name, started_at desc);

alter table job_runs enable row level security;
drop policy if exists job_runs_read on job_runs;
create policy job_runs_read on job_runs for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));

-- sync_state had RLS enabled with ZERO policies (invisible to every role). Let
-- operators read connector health; add an is_active toggle on sources.
drop policy if exists sync_state_read on sync_state;
create policy sync_state_read on sync_state for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));

drop policy if exists sources_update on sources;
create policy sources_update on sources for update to authenticated
  using (app_has_role(array['ceo','admin'])) with check (app_has_role(array['ceo','admin']));

-- ----------------------------------------------------------------------------
-- A8 — alert case management
-- ----------------------------------------------------------------------------
create table if not exists alert_notes (
  id                 uuid primary key default gen_random_uuid(),
  alert_id           uuid not null references alerts(id) on delete cascade,
  author_app_user_id uuid references app_users(id) on delete set null,
  note               text not null,
  created_at         timestamptz not null default now()
);
create index if not exists alert_notes_alert_idx on alert_notes (alert_id, created_at);

alter table alert_notes enable row level security;
drop policy if exists alert_notes_read on alert_notes;
create policy alert_notes_read on alert_notes for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));
drop policy if exists alert_notes_insert on alert_notes;
create policy alert_notes_insert on alert_notes for insert to authenticated
  with check (app_has_role(array['ceo','admin','security_analyst'])
              and author_app_user_id = app_current_app_user_id());

-- ----------------------------------------------------------------------------
-- D3 / E2 — audited, justification-gated content reveal
-- RLS grants ceo/admin raw SELECT on email_events including body_ref, with no
-- audit row — so no UI discipline can make human content access accountable.
-- Fix it with column privileges: remove the blanket SELECT and grant only the
-- non-body columns, then route body access through an audited definer RPC.
-- (apps/web never queries email_events directly; edge functions use the service
-- role, which bypasses column grants — so nothing breaks.)
-- ----------------------------------------------------------------------------
revoke select on email_events from anon, authenticated;
grant select (
  id, thread_id, source_id, provider_message_id, direction,
  from_identity_id, to_identity_ids, cc_identity_ids, bcc_identity_ids,
  owner_employee_id, owner_department_id, sent_at, has_attachments,
  external_recipient_count, is_personal_account_contact,
  subject, snippet, content_class, created_at
) on email_events to authenticated;
-- body_ref and body_fetched_reason are deliberately NOT granted.

create or replace function public.app_reveal_content(p_event_id uuid, p_justification text)
returns table (subject text, snippet text, body text)
language plpgsql security definer set search_path = public as $$
declare v_actor uuid;
begin
  if not app_has_role(array['ceo','admin']) then
    raise exception 'insufficient role for content reveal';
  end if;
  if p_justification is null or length(trim(p_justification)) < 3 then
    raise exception 'a justification is required to reveal message content';
  end if;
  v_actor := app_current_app_user_id();
  insert into audit_log (actor_app_user_id, action, target_table, target_id, accessed_content_class, justification)
    values (v_actor, 'view_content', 'email_events', p_event_id, 'content', p_justification);
  return query
    select e.subject, e.snippet, e.body_ref as body from email_events e where e.id = p_event_id;
end; $$;

revoke execute on function public.app_reveal_content(uuid, text) from public;
grant  execute on function public.app_reveal_content(uuid, text) to authenticated;
