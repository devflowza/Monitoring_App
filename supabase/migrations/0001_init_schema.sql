-- =============================================================================
-- Sentinel — 0001 init schema
-- Core data model + RLS + immutable audit-of-auditors for the monitoring/
-- compliance/BI platform. Compliance invariants enforced here:
--   * every event table carries content_class so RLS/retention treat raw
--     content differently from metadata at the row level
--   * message CONTENT (content_class='content') is readable only by ceo/admin
--   * audit_log is append-only (UPDATE/DELETE blocked by trigger — even for the
--     service role, which bypasses RLS but not triggers)
--   * default-deny RLS on every table
-- =============================================================================

create extension if not exists pgcrypto;      -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type content_class       as enum ('metadata', 'derived', 'content');
create type app_role            as enum ('ceo', 'admin', 'dept_manager', 'security_analyst', 'viewer');
create type employment_status   as enum ('active', 'inactive', 'terminated');
create type identity_type       as enum ('email', 'calendar', 'paypal_payer');
create type connector_mode      as enum ('mcp', 'google_admin');
create type source_kind         as enum ('gmail', 'drive', 'calendar', 'paypal');
create type email_direction     as enum ('inbound', 'outbound', 'internal');
create type file_action         as enum ('created', 'modified', 'shared', 'downloaded', 'exported', 'permission_change');
create type permission_type     as enum ('user', 'group', 'domain', 'anyone');
create type finance_object_type as enum ('invoice', 'transaction', 'dispute');
create type dlp_category        as enum ('quotation', 'pricing', 'contract', 'customer_db', 'financial', 'pii', 'credentials');
create type dlp_match_type      as enum ('keyword', 'regex', 'fingerprint');
create type sla_rule_type       as enum ('first_response', 'followup', 'quotation_turnaround', 'ops_milestone');
create type alert_type          as enum ('dlp', 'sla_breach', 'exfil', 'external_share', 'personal_email',
                                         'forwarding_rule', 'finance_delay', 'finance_suspicious',
                                         'anomaly', 'insider_threat', 'login_anomaly');
create type alert_severity      as enum ('info', 'low', 'medium', 'high', 'critical');
create type alert_status        as enum ('open', 'ack', 'resolved', 'false_positive');
create type scope_type          as enum ('employee', 'department', 'org');
create type audit_action        as enum ('view_content', 'view_alert', 'view_metadata', 'export_report',
                                         'change_policy', 'run_query', 'acknowledge_alert', 'resolve_alert');

-- ============================================================================
-- IDENTITY & ORG
-- ============================================================================
create table departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  -- manager_employee_id FK added after employees exists (circular dependency)
  manager_employee_id uuid,
  created_at  timestamptz not null default now()
);

create table employees (
  id                   uuid primary key default gen_random_uuid(),
  full_name            text not null,
  primary_email        text not null unique,
  department_id        uuid references departments(id) on delete set null,
  manager_id           uuid references employees(id) on delete set null,
  role_title           text,
  employment_status    employment_status not null default 'active',
  jurisdiction         text,                       -- drives lawful-basis / retention config (e.g. 'AE','EU','UK')
  monitoring_consent_at timestamptz,               -- when the employee was given monitoring notice
  is_monitored         boolean not null default true,  -- per-person kill switch
  created_at           timestamptz not null default now()
);
create index employees_department_idx on employees(department_id);

alter table departments
  add constraint departments_manager_fk
  foreign key (manager_employee_id) references employees(id) on delete set null;

-- Every email address / calendar / payer maps to an identity; employee_id null = external contact.
create table identities (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid references employees(id) on delete cascade,
  identity_type      identity_type not null default 'email',
  value              text not null,                -- normalized (lowercased) email / id
  is_internal        boolean not null default false,
  is_external_contact boolean generated always as (employee_id is null) stored,
  is_competitor      boolean not null default false,  -- flagged suspicious external domain/contact
  created_at         timestamptz not null default now(),
  unique (identity_type, value)
);
create index identities_employee_idx on identities(employee_id);

-- ============================================================================
-- SOURCES & SYNC
-- ============================================================================
create table sources (
  id           uuid primary key default gen_random_uuid(),
  kind         source_kind not null,
  mode         connector_mode not null default 'mcp',
  display_name text not null,
  is_active    boolean not null default true,
  config_json  jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (kind, display_name)
);

create table sync_state (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references sources(id) on delete cascade,
  cursor        text,                              -- incremental token / historyId / last timestamp
  last_run_at   timestamptz,
  last_status   text,                              -- ok | throttled | error
  error_detail  text,
  updated_at    timestamptz not null default now(),
  unique (source_id)
);

-- ============================================================================
-- EMAIL INTELLIGENCE  (metadata-first; bodies only on policy match)
-- ============================================================================
create table email_threads (
  id                         uuid primary key default gen_random_uuid(),
  source_id                  uuid references sources(id) on delete set null,
  provider_thread_id         text not null,
  subject                    text,                 -- content_class=metadata, redactable
  first_message_at           timestamptz,
  last_message_at            timestamptz,
  participant_internal_count int default 0,
  participant_external_count int default 0,
  content_class              content_class not null default 'metadata',
  synced_at                  timestamptz not null default now(),
  unique (provider_thread_id)
);

create table email_events (
  id                        uuid primary key default gen_random_uuid(),
  thread_id                 uuid references email_threads(id) on delete cascade,
  source_id                 uuid references sources(id) on delete set null,
  provider_message_id       text not null,
  direction                 email_direction not null,
  from_identity_id          uuid references identities(id),
  to_identity_ids           uuid[] not null default '{}',
  cc_identity_ids           uuid[] not null default '{}',
  bcc_identity_ids          uuid[] not null default '{}',
  -- denormalized owner (internal party the event is attributed to) for RLS dept scoping
  owner_employee_id         uuid references employees(id) on delete set null,
  owner_department_id       uuid references departments(id) on delete set null,
  sent_at                   timestamptz,
  has_attachments           boolean not null default false,
  external_recipient_count  int not null default 0,
  is_personal_account_contact boolean not null default false,  -- gmail.com/yahoo.com etc.
  subject                   text,                 -- metadata
  snippet                   text,                 -- metadata, nullable/redactable
  body_ref                  text,                 -- content_class=content: pointer to encrypted blob; null by default
  body_fetched_reason       text,                 -- why content was pulled (alert/policy id)
  content_class             content_class not null default 'metadata',
  created_at                timestamptz not null default now(),
  unique (provider_message_id)
);
create index email_events_owner_dept_idx on email_events(owner_department_id);
create index email_events_thread_idx on email_events(thread_id);
create index email_events_sent_at_idx on email_events(sent_at);

create table attachments (
  id             uuid primary key default gen_random_uuid(),
  email_event_id uuid not null references email_events(id) on delete cascade,
  filename       text,                            -- metadata
  mime_type      text,
  size_bytes     bigint,
  sha256         text,                            -- dedup + known-sensitive-doc fingerprinting
  is_sensitive_type boolean not null default false,
  content_class  content_class not null default 'metadata',
  created_at     timestamptz not null default now()
);
create index attachments_sha256_idx on attachments(sha256);

create table forwarding_rules (
  id                    uuid primary key default gen_random_uuid(),
  identity_id           uuid references identities(id) on delete cascade,
  rule_type             text not null,            -- auto_forward | filter
  destination           text,
  is_external_destination boolean not null default false,
  detected_at           timestamptz not null default now(),
  source_id             uuid references sources(id) on delete set null
);

-- ============================================================================
-- DRIVE / FILES
-- ============================================================================
create table file_events (
  id                  uuid primary key default gen_random_uuid(),
  source_id           uuid references sources(id) on delete set null,
  provider_file_id    text not null,
  identity_id         uuid references identities(id),
  owner_employee_id   uuid references employees(id) on delete set null,
  owner_department_id uuid references departments(id) on delete set null,
  action              file_action not null,
  file_name           text,                       -- metadata
  mime_type           text,
  is_sensitive_type   boolean not null default false,
  occurred_at         timestamptz,
  content_class       content_class not null default 'metadata',
  created_at          timestamptz not null default now(),
  unique (provider_file_id, action, occurred_at)
);
create index file_events_owner_dept_idx on file_events(owner_department_id);

-- The spine of external-sharing / exfiltration detection.
create table file_permissions (
  id               uuid primary key default gen_random_uuid(),
  source_id        uuid references sources(id) on delete set null,
  provider_file_id text not null,
  file_name        text,
  permission_type  permission_type not null,
  grantee          text,                           -- email / domain / 'anyone'
  is_external      boolean not null default false,
  is_public_link   boolean not null default false,
  role             text,                           -- reader | writer | owner
  detected_at      timestamptz not null default now(),
  content_class    content_class not null default 'metadata'
);
create index file_permissions_file_idx on file_permissions(provider_file_id);

-- ============================================================================
-- CALENDAR / FINANCE
-- ============================================================================
create table calendar_events (
  id                    uuid primary key default gen_random_uuid(),
  source_id             uuid references sources(id) on delete set null,
  provider_event_id     text not null unique,
  organizer_identity_id uuid references identities(id),
  attendee_identity_ids uuid[] not null default '{}',
  title                 text,                       -- metadata
  starts_at             timestamptz,
  ends_at               timestamptz,
  has_external_attendees boolean not null default false,
  content_class         content_class not null default 'metadata',
  created_at            timestamptz not null default now()
);

create table finance_events (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid references sources(id) on delete set null,
  provider_object_id text not null,
  object_type       finance_object_type not null,
  status            text,                           -- draft|sent|paid|overdue|disputed
  counterparty      text,
  amount            numeric(14,2),
  currency          text,
  issued_at         timestamptz,
  due_at            timestamptz,
  paid_at           timestamptz,
  linked_employee_id uuid references employees(id) on delete set null,
  is_suspicious     boolean not null default false,
  content_class     content_class not null default 'metadata',
  created_at        timestamptz not null default now(),
  unique (object_type, provider_object_id)
);

-- ============================================================================
-- POLICY & RULES
-- ============================================================================
create table dlp_rules (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  category             dlp_category not null,
  match_type           dlp_match_type not null default 'keyword',
  pattern              text not null,
  severity_weight      int not null default 50,    -- 0..100 contribution
  requires_claude_confirm boolean not null default true,
  jurisdiction_scope   text,                       -- null = all
  is_active            boolean not null default true,
  created_at           timestamptz not null default now()
);

create table sla_rules (
  id                uuid primary key default gen_random_uuid(),
  department_id     uuid references departments(id) on delete cascade,  -- null = global
  rule_type         sla_rule_type not null,
  threshold_minutes int not null,
  business_hours_only boolean not null default true,
  severity_weight   int not null default 50,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- Key/value org policy (incl. the compliance gates).
create table policies (
  id           uuid primary key default gen_random_uuid(),
  policy_key   text not null,
  value_json   jsonb not null,
  jurisdiction text,                               -- null = global
  effective_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (policy_key, jurisdiction)
);

-- Tunable, auditable risk-model weights (CEO/admin editable).
create table risk_weights (
  id          uuid primary key default gen_random_uuid(),
  factor_key  text not null unique,
  weight      numeric(6,3) not null default 1.0,
  description text,
  updated_at  timestamptz not null default now()
);

-- ============================================================================
-- INTELLIGENCE / DERIVED
-- ============================================================================
create table alerts (
  id                 uuid primary key default gen_random_uuid(),
  alert_type         alert_type not null,
  severity           alert_severity not null default 'medium',
  status             alert_status not null default 'open',
  employee_id        uuid references employees(id) on delete set null,
  department_id      uuid references departments(id) on delete set null,
  source_event_table text,                          -- polymorphic evidence link
  source_event_id    uuid,
  rule_id            uuid,
  title              text not null,
  summary            text,                          -- Claude-generated, metadata-safe
  evidence_json      jsonb not null default '{}'::jsonb,  -- metadata pointers, NOT raw content
  dedup_key          text not null,
  occurrence_count   int not null default 1,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  acknowledged_by    uuid references employees(id) on delete set null,
  resolved_by        uuid references employees(id) on delete set null,
  updated_at         timestamptz not null default now(),
  unique (dedup_key)
);
create index alerts_status_sev_idx on alerts(status, severity);
create index alerts_dept_idx on alerts(department_id);
create index alerts_type_idx on alerts(alert_type);

create table metrics_daily (
  id          uuid primary key default gen_random_uuid(),
  metric_date date not null,
  scope_type  scope_type not null,
  scope_id    uuid,                                 -- employee/department id; null for org
  metric_key  text not null,
  metric_value numeric not null,
  computed_at timestamptz not null default now(),
  unique (metric_date, scope_type, scope_id, metric_key)
);
create index metrics_daily_scope_idx on metrics_daily(scope_type, scope_id, metric_date);

create table risk_scores (
  id                     uuid primary key default gen_random_uuid(),
  scope_type             scope_type not null,
  scope_id               uuid,
  score_date             date not null,
  total_score            numeric(5,2) not null,     -- 0..100
  component_breakdown_json jsonb not null default '{}'::jsonb,  -- per-factor contributions (transparency)
  tier                   text not null,             -- low|elevated|high|critical
  trend_vs_prev          numeric(5,2),
  model_version          text not null default 'v1',
  created_at             timestamptz not null default now(),
  unique (scope_type, scope_id, score_date)
);
create index risk_scores_scope_idx on risk_scores(scope_type, scope_id, score_date);

create table reports (
  id                 uuid primary key default gen_random_uuid(),
  report_type        text not null,                 -- daily|weekly|monthly|dept|employee|security|risk
  scope_type         scope_type not null default 'org',
  scope_id           uuid,
  period_start       date,
  period_end         date,
  narrative_md       text,                          -- Claude-generated
  recommendations_json jsonb not null default '[]'::jsonb,
  pdf_ref            text,                          -- storage pointer
  generated_by_model text,
  status             text not null default 'draft',
  created_at         timestamptz not null default now()
);

-- ============================================================================
-- SYSTEM GOVERNANCE (the "audit-of-auditors")
-- ============================================================================
create table app_users (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,                -- references auth.users(id)
  employee_id  uuid references employees(id) on delete set null,
  display_name text,
  created_at   timestamptz not null default now()
);

create table user_roles (
  id            uuid primary key default gen_random_uuid(),
  app_user_id   uuid not null references app_users(id) on delete cascade,
  role          app_role not null,
  department_id uuid references departments(id) on delete cascade,  -- scope for dept_manager
  created_at    timestamptz not null default now(),
  unique (app_user_id, role, department_id)
);

-- Immutable: every sensitive read / export / policy change is recorded here.
create table audit_log (
  id                    uuid primary key default gen_random_uuid(),
  actor_app_user_id     uuid references app_users(id),
  action                audit_action not null,
  target_table          text,
  target_id             uuid,
  accessed_content_class content_class,
  justification         text,
  ip                    text,
  user_agent            text,
  occurred_at           timestamptz not null default now()
);
create index audit_log_actor_idx on audit_log(actor_app_user_id, occurred_at);

-- ============================================================================
-- HELPER FUNCTIONS (SECURITY DEFINER — used by RLS policies)
-- ============================================================================
create or replace function public.app_current_app_user_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from app_users where auth_user_id = auth.uid();
$$;

create or replace function public.app_has_role(required text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from user_roles ur
    join app_users au on au.id = ur.app_user_id
    where au.auth_user_id = auth.uid()
      and ur.role::text = any(required)
  );
$$;

create or replace function public.app_managed_department_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select ur.department_id
  from user_roles ur
  join app_users au on au.id = ur.app_user_id
  where au.auth_user_id = auth.uid()
    and ur.role = 'dept_manager'
    and ur.department_id is not null;
$$;

-- updated_at touch + audit immutability
create or replace function public.app_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create or replace function public.app_block_mutation()
returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only: % is not permitted', tg_op; end;
$$;

create trigger alerts_touch before update on alerts
  for each row execute function public.app_touch_updated_at();
create trigger audit_log_no_update before update on audit_log
  for each row execute function public.app_block_mutation();
create trigger audit_log_no_delete before delete on audit_log
  for each row execute function public.app_block_mutation();

-- ============================================================================
-- ROW LEVEL SECURITY  (default-deny: enable everywhere, grant explicitly)
-- ============================================================================
alter table departments       enable row level security;
alter table employees         enable row level security;
alter table identities        enable row level security;
alter table sources           enable row level security;
alter table sync_state        enable row level security;
alter table email_threads     enable row level security;
alter table email_events      enable row level security;
alter table attachments       enable row level security;
alter table forwarding_rules  enable row level security;
alter table file_events       enable row level security;
alter table file_permissions  enable row level security;
alter table calendar_events   enable row level security;
alter table finance_events    enable row level security;
alter table dlp_rules         enable row level security;
alter table sla_rules         enable row level security;
alter table policies          enable row level security;
alter table risk_weights      enable row level security;
alter table alerts            enable row level security;
alter table metrics_daily     enable row level security;
alter table risk_scores       enable row level security;
alter table reports           enable row level security;
alter table app_users         enable row level security;
alter table user_roles        enable row level security;
alter table audit_log         enable row level security;

-- Reference/identity tables: any authenticated staff operator may read.
create policy ref_read on departments for select to authenticated
  using (app_has_role(array['ceo','admin','dept_manager','security_analyst','viewer']));
create policy ref_read on employees for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst'])
         or department_id in (select app_managed_department_ids()));
create policy ref_read on identities for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst','dept_manager']));

-- Operational config: read for ceo/admin/analyst; write for ceo/admin.
create policy cfg_read on dlp_rules for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));
create policy cfg_write on dlp_rules for all to authenticated
  using (app_has_role(array['ceo','admin'])) with check (app_has_role(array['ceo','admin']));
create policy cfg_read on sla_rules for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));
create policy cfg_write on sla_rules for all to authenticated
  using (app_has_role(array['ceo','admin'])) with check (app_has_role(array['ceo','admin']));
create policy cfg_read on policies for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));
create policy cfg_write on policies for all to authenticated
  using (app_has_role(array['ceo','admin'])) with check (app_has_role(array['ceo','admin']));
create policy cfg_read on risk_weights for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));
create policy cfg_write on risk_weights for all to authenticated
  using (app_has_role(array['ceo','admin'])) with check (app_has_role(array['ceo','admin']));
create policy cfg_read on sources for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));

-- Email threads: metadata readable by ceo/admin/analyst.
create policy thread_read on email_threads for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));

-- Email events: CONTENT GATE — content rows only for ceo/admin; metadata/derived
-- for analyst; dept_manager scoped to their department's metadata.
create policy email_read on email_events for select to authenticated
  using (
    case
      when content_class = 'content' then app_has_role(array['ceo','admin'])
      else app_has_role(array['ceo','admin','security_analyst'])
           or owner_department_id in (select app_managed_department_ids())
    end
  );

-- Attachments inherit the same content gate.
create policy attachment_read on attachments for select to authenticated
  using (
    case
      when content_class = 'content' then app_has_role(array['ceo','admin'])
      else app_has_role(array['ceo','admin','security_analyst'])
    end
  );

-- Other event tables: metadata for ceo/admin/analyst; dept_manager scoped where applicable.
create policy ev_read on file_events for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst'])
         or owner_department_id in (select app_managed_department_ids()));
create policy ev_read on file_permissions for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));
create policy ev_read on forwarding_rules for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));
create policy ev_read on calendar_events for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));
create policy ev_read on finance_events for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));

-- Alerts: ceo/admin/analyst see all; dept_manager scoped; viewer none (aggregates only).
create policy alert_read on alerts for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst'])
         or department_id in (select app_managed_department_ids()));
create policy alert_update on alerts for update to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']))
  with check (app_has_role(array['ceo','admin','security_analyst']));

-- Aggregates: visible to all roles incl. viewer (no raw content).
create policy agg_read on metrics_daily for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst','dept_manager','viewer']));
create policy agg_read on risk_scores for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst','viewer'])
         or scope_id in (select app_managed_department_ids()));
create policy report_read on reports for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));

-- Identity/role self-service reads.
create policy self_read on app_users for select to authenticated
  using (auth_user_id = auth.uid() or app_has_role(array['ceo','admin']));
create policy roles_read on user_roles for select to authenticated
  using (app_user_id = app_current_app_user_id() or app_has_role(array['ceo','admin']));

-- audit_log: INSERT by any authenticated app operator; SELECT for ceo/admin/analyst;
-- UPDATE/DELETE blocked by trigger above (no policy grants them either).
create policy audit_insert on audit_log for insert to authenticated
  with check (actor_app_user_id = app_current_app_user_id());
create policy audit_read on audit_log for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));

-- ============================================================================
-- REALTIME — publish alerts for the live in-app incident feed
-- ============================================================================
alter publication supabase_realtime add table alerts;

-- ----------------------------------------------------------------------------
-- NOTE: pg_cron / pg_net scheduling of ingest + analyze edge functions is set
-- up in a later migration (0003), once the functions are deployed and the
-- project ref / function URLs are known.
-- ----------------------------------------------------------------------------
