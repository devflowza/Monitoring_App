-- =============================================================================
-- Sentinel — 0002 seed
-- Baseline org config: departments, compliance policy gates (OFF by default),
-- risk-model weights, and starter DLP / SLA rules. Safe to run on a fresh DB.
-- Employees/identities are populated by ingestion + a directory sync; the first
-- ceo operator is bootstrapped manually (see the snippet at the bottom).
-- =============================================================================

-- --- Departments -------------------------------------------------------------
insert into departments (name) values
  ('Management'), ('Sales'), ('Operations'), ('Finance'), ('IT')
on conflict (name) do nothing;

-- --- Compliance + behavior policies ------------------------------------------
-- monitoring_active and notice_delivered are the GO-LIVE GATE. Full-content
-- org-wide processing stays inert until both are flipped true (after employee
-- notice + DPIA). store_all_bodies stays false to minimize stored content.
insert into policies (policy_key, value_json) values
  ('monitoring_active',        '{"value": false}'),
  ('notice_delivered',         '{"value": false}'),
  ('store_all_bodies',         '{"value": false}'),
  ('content_retention_days',   '{"value": 90}'),
  ('metadata_retention_days',  '{"value": 365}'),
  ('business_hours',           '{"tz": "Asia/Dubai", "start": "08:00", "end": "18:00", "workdays": [1,2,3,4,5]}'),
  ('personal_email_domains',   '{"value": ["gmail.com","yahoo.com","hotmail.com","outlook.com","icloud.com","protonmail.com"]}'),
  ('internal_domains',         '{"value": ["visionfreights.com"]}')
on conflict (policy_key, jurisdiction) do nothing;

-- --- Risk-model weights (tunable, auditable) ---------------------------------
insert into risk_weights (factor_key, weight, description) values
  ('dlp_incident',        3.0, 'DLP incidents (confidential data leaving the org), rolling 30d'),
  ('external_sharing',    2.0, 'Sensitive files shared externally / via public link'),
  ('personal_email',      2.0, 'Sensitive data sent to personal / unknown external accounts'),
  ('competitor_contact',  2.5, 'Communication with flagged competitor / suspicious contacts'),
  ('mass_export',         2.5, 'Mass-email or bulk-download/export bursts'),
  ('sla_breach',          1.0, 'SLA / follow-up breach rate (negligence signal)'),
  ('offhours_anomaly',    1.0, 'Off-hours / inactivity / overload anomalies'),
  ('finance_suspicion',   2.0, 'Suspicious finance communications / irregularities'),
  ('forwarding_rule',     2.0, 'Auto-forwarding to external destinations')
on conflict (factor_key) do nothing;

-- --- Starter DLP rules -------------------------------------------------------
-- match_type='keyword' patterns are '|'-separated, case-insensitive tokens; the
-- DLP engine pre-filters with these, then Claude adjudicates flagged candidates.
insert into dlp_rules (name, category, match_type, pattern, severity_weight, requires_claude_confirm) values
  ('Pricing / rate disclosure', 'pricing',     'keyword', 'price list|rate sheet|freight rate|our rate|net rate|buying rate|selling rate|cost price', 70, true),
  ('Quotation leakage',         'quotation',   'keyword', 'quotation|quote no|quote ref|proforma|pro forma|offer letter', 60, true),
  ('Contract / agreement',      'contract',    'keyword', 'contract|agreement|mou|nda|terms and conditions|signed copy', 55, true),
  ('Customer database export',  'customer_db', 'regex',   '(?i)(customer|client|contact)\s*(list|database|export|dump)', 80, true),
  ('Financial documents',       'financial',   'keyword', 'invoice|bank statement|balance sheet|p&l|profit and loss|payment details|swift|iban', 65, true),
  ('PII / passport / ID',       'pii',         'regex',   '(?i)\b(passport|emirates id|national id|visa number)\b', 60, true),
  ('Credential exposure',       'credentials', 'regex',   '(?i)(password|api[_ ]?key|secret|access token)\s*[:=]', 75, false)
on conflict do nothing;

-- --- Starter SLA rules -------------------------------------------------------
insert into sla_rules (department_id, rule_type, threshold_minutes, business_hours_only, severity_weight)
select id, 'first_response', 120, true, 60 from departments where name = 'Sales'
union all
select id, 'followup', 1440, true, 50 from departments where name = 'Sales'
union all
select id, 'quotation_turnaround', 480, true, 55 from departments where name = 'Sales'
union all
select id, 'first_response', 240, true, 50 from departments where name = 'Operations'
union all
select id, 'ops_milestone', 1440, true, 55 from departments where name = 'Operations'
union all
select id, 'first_response', 480, true, 45 from departments where name = 'Finance';

-- --- Default sources (dev/test = mcp single account; flip to google_admin org-wide) ---
insert into sources (kind, mode, display_name, is_active) values
  ('gmail',    'mcp', 'Admin mailbox (dev)', true),
  ('drive',    'mcp', 'Admin drive (dev)',   true),
  ('calendar', 'mcp', 'Admin calendar (dev)',true),
  ('paypal',   'mcp', 'PayPal (finance)',    true)
on conflict (kind, display_name) do nothing;

-- -----------------------------------------------------------------------------
-- BOOTSTRAP THE FIRST OPERATOR (run manually after the CEO signs in via Supabase
-- Auth, replacing the email). Grants the ceo role so RLS lets them see content.
--
--   with u as (select id from auth.users where email = 'md@visionfreights.com')
--   insert into app_users (auth_user_id, display_name)
--     select id, 'Managing Director' from u
--     on conflict (auth_user_id) do nothing;
--   insert into user_roles (app_user_id, role)
--     select au.id, 'ceo' from app_users au
--     join u on u.id = au.auth_user_id
--     on conflict do nothing;
-- -----------------------------------------------------------------------------
