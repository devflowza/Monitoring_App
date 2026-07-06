-- =============================================================================
-- Sentinel — 0004 Milestone-0 hardening
-- Launch-blocker fixes for the schema/DB layer:
--   * D7  seed idempotency: NULLS NOT DISTINCT natural keys so re-seeding never
--         silently duplicates policy/rule rows (which would break getPolicy).
--   * D8  dedup constraints + last_seen_at for the exposure tables so ingest can
--         upsert instead of accumulating duplicate rows every cron tick.
--   * D3  revoke PUBLIC execute on the service-role-wielding cron helpers, and
--         teach app_invoke_function to send the shared edge-function secret.
--   * body_ref CHECK: turn the "metadata unless flagged" privacy invariant from a
--         code convention into a DB-enforced constraint.
-- Re-runnable: all changes guarded with IF [NOT] EXISTS / OR REPLACE.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- D7 — idempotent natural keys (NULLS NOT DISTINCT, PG15+)
-- policies.jurisdiction / sla_rules.department_id are nullable and NULL means
-- "global"; the default NULLS-DISTINCT semantics let duplicate global rows slip
-- past ON CONFLICT. Replace with NULLS NOT DISTINCT unique indexes.
-- ----------------------------------------------------------------------------
alter table policies drop constraint if exists policies_policy_key_jurisdiction_key;
create unique index if not exists policies_key_jurisdiction_uidx
  on policies (policy_key, jurisdiction) nulls not distinct;

create unique index if not exists dlp_rules_name_uidx
  on dlp_rules (name);

create unique index if not exists sla_rules_dept_type_uidx
  on sla_rules (department_id, rule_type) nulls not distinct;

-- ----------------------------------------------------------------------------
-- D8 — exposure-table dedup + last_seen_at
-- ----------------------------------------------------------------------------
alter table forwarding_rules add column if not exists last_seen_at timestamptz not null default now();
alter table file_permissions add column if not exists last_seen_at timestamptz not null default now();

create unique index if not exists forwarding_rules_dedup_uidx
  on forwarding_rules (identity_id, rule_type, destination) nulls not distinct;
create unique index if not exists file_permissions_dedup_uidx
  on file_permissions (source_id, provider_file_id, grantee) nulls not distinct;

-- Hot-path index for the retention purge / external-share scan.
create index if not exists file_permissions_detected_at_idx on file_permissions (detected_at);

-- ----------------------------------------------------------------------------
-- body_ref invariant — content_class='content' iff a body is stored.
-- All three writers (ingest-email, analyze scrub, retention purge) already
-- maintain this by convention, so the constraint is safe to add.
-- ----------------------------------------------------------------------------
alter table email_events drop constraint if exists email_events_content_body_ck;
alter table email_events add constraint email_events_content_body_ck
  check ((content_class = 'content') = (body_ref is not null));

-- ----------------------------------------------------------------------------
-- D3 — lock down the SECURITY DEFINER cron helpers.
-- Both wield the service-role key (directly or by invoking functions with it);
-- neither should ever be callable by a PostgREST client. Default grants give
-- EXECUTE to PUBLIC, so revoke it.
-- ----------------------------------------------------------------------------
revoke execute on function public.app_invoke_function(text, jsonb) from public;
revoke execute on function public.app_purge_expired() from public;

-- Teach the cron invoker to authenticate to the edge functions with a shared
-- secret (stored in Vault as 'edge_shared_secret'). Functions enforce it only
-- when their EDGE_SHARED_SECRET env is set, so this is backward compatible: if
-- the secret is absent from Vault the header is simply omitted.
create or replace function public.app_invoke_function(fn text, body jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, vault as $$
declare base text; key text; edge_secret text; hdrs jsonb;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into key  from vault.decrypted_secrets where name = 'service_role_key';
  if base is null or key is null then return; end if;
  select decrypted_secret into edge_secret from vault.decrypted_secrets where name = 'edge_shared_secret';

  hdrs := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key);
  if edge_secret is not null then
    hdrs := hdrs || jsonb_build_object('x-sentinel-secret', edge_secret);
  end if;

  perform net.http_post(url := base || '/functions/v1/' || fn, headers := hdrs, body := body);
end; $$;

-- app_invoke_function is called only by cron (which runs as the table owner /
-- superuser), so it needs no client grants after the revoke above.
