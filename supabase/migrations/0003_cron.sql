-- =============================================================================
-- Sentinel — 0003 scheduling + retention
-- Wires the edge functions to pg_cron via pg_net, and the nightly retention
-- purge. Without this migration nothing runs automatically.
--
-- PREREQUISITE (operator, once): store the project URL + service-role key in
-- Vault so cron can call the functions authenticated:
--   select vault.create_secret('https://YOUR-REF.supabase.co', 'project_url');
--   select vault.create_secret('YOUR-SERVICE-ROLE-KEY',        'service_role_key');
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Authenticated invoke helper (reads secrets from Vault; no-ops if unset).
create or replace function public.app_invoke_function(fn text, body jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, vault as $$
declare base text; key text;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into key  from vault.decrypted_secrets where name = 'service_role_key';
  if base is null or key is null then return; end if;
  perform net.http_post(
    url := base || '/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
    body := body
  );
end; $$;

-- Nightly retention: redact expired content first, then delete aged metadata.
create or replace function public.app_purge_expired()
returns void language plpgsql security definer set search_path = public as $$
declare content_days int; meta_days int;
begin
  select (value_json->>'value')::int into content_days from policies where policy_key = 'content_retention_days' and jurisdiction is null;
  select (value_json->>'value')::int into meta_days   from policies where policy_key = 'metadata_retention_days' and jurisdiction is null;
  content_days := coalesce(content_days, 90);
  meta_days := coalesce(meta_days, 365);

  update email_events set body_ref = null, content_class = 'metadata'
    where content_class = 'content' and sent_at < now() - make_interval(days => content_days);
  delete from email_events where sent_at < now() - make_interval(days => meta_days);
  delete from file_permissions where detected_at < now() - make_interval(days => meta_days);

  insert into audit_log (actor_app_user_id, action, target_table, justification)
    values (null, 'run_query', 'email_events', 'nightly retention purge');
end; $$;

-- ---- Schedules (staggered). cron.schedule(name, …) upserts by job name. ------
select cron.schedule('sentinel-ingest-email',   '*/10 * * * *', $$select app_invoke_function('ingest-email')$$);
select cron.schedule('sentinel-ingest-drive',   '2-59/15 * * * *', $$select app_invoke_function('ingest-drive')$$);
select cron.schedule('sentinel-sync-directory', '7 * * * *',    $$select app_invoke_function('sync-directory')$$);
select cron.schedule('sentinel-analyze',        '5-59/10 * * * *', $$select app_invoke_function('analyze')$$);
select cron.schedule('sentinel-compute-metrics','20 * * * *',   $$select app_invoke_function('compute-metrics')$$);
select cron.schedule('sentinel-ingest-finance', '30 */6 * * *', $$select app_invoke_function('ingest-finance')$$);
select cron.schedule('sentinel-alert-dispatch', '*/5 * * * *',  $$select app_invoke_function('alert-dispatch')$$);
select cron.schedule('sentinel-score-risk',     '15 2 * * *',   $$select app_invoke_function('score-risk')$$);
select cron.schedule('sentinel-report-daily',   '0 6 * * *',    $$select app_invoke_function('report-generate', '{"type":"daily"}')$$);
select cron.schedule('sentinel-report-weekly',  '30 6 * * 1',   $$select app_invoke_function('report-generate', '{"type":"weekly"}')$$);
select cron.schedule('sentinel-retention-purge','0 3 * * *',    $$select app_purge_expired()$$);
