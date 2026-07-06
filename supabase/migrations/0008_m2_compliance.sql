-- =============================================================================
-- Sentinel — 0008 Milestone-2: compliance tooling
--   * D6  jurisdiction-aware retention purge covering all event tables + a
--         proper retention_purge audit action with per-table counts
--   * D7  DSAR export / erase as audited SECURITY DEFINER functions
--   *     app_set_monitored — role-gated is_monitored toggle for the UI
-- Re-runnable.
-- =============================================================================

-- New audit actions (must exist before the functions that write them run).
alter type audit_action add value if not exists 'retention_purge';
alter type audit_action add value if not exists 'dsar_export';
alter type audit_action add value if not exists 'dsar_erase';

-- ----------------------------------------------------------------------------
-- D6 — complete, jurisdiction-aware retention purge
-- ----------------------------------------------------------------------------
create or replace function public.app_purge_expired()
returns void language plpgsql security definer set search_path = public as $$
declare content_days int; meta_days int; purged jsonb := '{}'::jsonb; n int;
begin
  select coalesce((value_json->>'value')::int, 90)  into content_days from policies where policy_key = 'content_retention_days'  and jurisdiction is null;
  select coalesce((value_json->>'value')::int, 365) into meta_days    from policies where policy_key = 'metadata_retention_days' and jurisdiction is null;
  content_days := coalesce(content_days, 90);
  meta_days := coalesce(meta_days, 365);

  -- Content redaction, jurisdiction-aware: an employee's jurisdiction override
  -- (policies row with that jurisdiction) wins over the global TTL; created_at
  -- is the fallback when sent_at is null (previously such rows were immortal).
  with eff as (
    select e.id,
      coalesce(
        (select (p.value_json->>'value')::int
           from policies p join employees emp on emp.id = e.owner_employee_id
          where p.policy_key = 'content_retention_days' and p.jurisdiction = emp.jurisdiction
          limit 1),
        content_days) as days,
      coalesce(e.sent_at, e.created_at) as ts
    from email_events e where e.content_class = 'content'
  )
  update email_events e set body_ref = null, content_class = 'metadata'
    from eff where eff.id = e.id and eff.ts < now() - make_interval(days => eff.days);
  get diagnostics n = row_count; purged := purged || jsonb_build_object('email_content_redacted', n);

  -- Metadata deletes (global TTL), all event + derived tables.
  delete from email_events where coalesce(sent_at, created_at) < now() - make_interval(days => meta_days);
  get diagnostics n = row_count; purged := purged || jsonb_build_object('email_events', n);

  delete from email_threads t
   where not exists (select 1 from email_events e where e.thread_id = t.id)
     and coalesce(t.last_message_at, t.synced_at) < now() - make_interval(days => meta_days);
  get diagnostics n = row_count; purged := purged || jsonb_build_object('email_threads', n);

  delete from file_permissions where detected_at < now() - make_interval(days => meta_days);
  get diagnostics n = row_count; purged := purged || jsonb_build_object('file_permissions', n);
  delete from forwarding_rules where detected_at < now() - make_interval(days => meta_days);
  get diagnostics n = row_count; purged := purged || jsonb_build_object('forwarding_rules', n);
  delete from file_events where coalesce(occurred_at, created_at) < now() - make_interval(days => meta_days);
  get diagnostics n = row_count; purged := purged || jsonb_build_object('file_events', n);
  delete from calendar_events where coalesce(starts_at, created_at) < now() - make_interval(days => meta_days);
  get diagnostics n = row_count; purged := purged || jsonb_build_object('calendar_events', n);
  delete from finance_events where created_at < now() - make_interval(days => meta_days);
  get diagnostics n = row_count; purged := purged || jsonb_build_object('finance_events', n);
  delete from alerts where status in ('resolved','false_positive') and updated_at < now() - make_interval(days => meta_days);
  get diagnostics n = row_count; purged := purged || jsonb_build_object('alerts_resolved', n);
  delete from metrics_daily where metric_date < (now() - make_interval(days => meta_days))::date;
  get diagnostics n = row_count; purged := purged || jsonb_build_object('metrics_daily', n);
  delete from risk_scores where score_date < (now() - make_interval(days => meta_days))::date;
  get diagnostics n = row_count; purged := purged || jsonb_build_object('risk_scores', n);
  delete from reports where created_at < now() - make_interval(days => meta_days);
  get diagnostics n = row_count; purged := purged || jsonb_build_object('reports', n);
  delete from job_runs where started_at < now() - make_interval(days => meta_days);
  get diagnostics n = row_count; purged := purged || jsonb_build_object('job_runs', n);

  -- pg_cron history grows unbounded; trim it (best-effort — needs privilege).
  begin
    delete from cron.job_run_details where end_time < now() - interval '30 days';
    get diagnostics n = row_count; purged := purged || jsonb_build_object('cron_job_run_details', n);
  exception when others then null;
  end;

  insert into audit_log (actor_app_user_id, action, target_table, justification)
    values (null, 'retention_purge', 'multiple', 'nightly retention purge: ' || purged::text);
end; $$;

revoke execute on function public.app_purge_expired() from public;

-- ----------------------------------------------------------------------------
-- D7 — DSAR export / erase
-- ----------------------------------------------------------------------------
create or replace function public.app_dsar_export(p_employee_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare doc jsonb;
begin
  if not app_has_role(array['ceo','admin']) then raise exception 'insufficient role for DSAR export'; end if;
  select jsonb_build_object(
    'generated_at', now(),
    'employee',       (select to_jsonb(e) from employees e where e.id = p_employee_id),
    'identities',     (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from identities i where i.employee_id = p_employee_id),
    'email_events',   (select coalesce(jsonb_agg(jsonb_build_object('id', ev.id, 'direction', ev.direction, 'sent_at', ev.sent_at, 'subject', ev.subject, 'content_class', ev.content_class)), '[]')
                         from email_events ev where ev.owner_employee_id = p_employee_id),
    'file_events',    (select coalesce(jsonb_agg(to_jsonb(f)), '[]') from file_events f where f.owner_employee_id = p_employee_id),
    'finance_events', (select coalesce(jsonb_agg(to_jsonb(fe)), '[]') from finance_events fe where fe.linked_employee_id = p_employee_id),
    'alerts',         (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from alerts a where a.employee_id = p_employee_id),
    'risk_scores',    (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from risk_scores r where r.scope_type = 'employee' and r.scope_id = p_employee_id),
    'metrics',        (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from metrics_daily m where m.scope_type = 'employee' and m.scope_id = p_employee_id)
  ) into doc;
  insert into audit_log (actor_app_user_id, action, target_table, target_id, justification)
    values (app_current_app_user_id(), 'dsar_export', 'employees', p_employee_id, 'DSAR subject-data export');
  return doc;
end; $$;

create or replace function public.app_dsar_erase(p_employee_id uuid, p_justification text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_has_role(array['ceo','admin']) then raise exception 'insufficient role for DSAR erasure'; end if;
  if p_justification is null or length(trim(p_justification)) < 3 then raise exception 'a justification is required for erasure'; end if;
  update email_events set body_ref = null, content_class = 'metadata'
    where owner_employee_id = p_employee_id and content_class = 'content';
  update attachments a set filename = null, sha256 = null
    where exists (select 1 from email_events e where e.id = a.email_event_id and e.owner_employee_id = p_employee_id);
  update employees set is_monitored = false where id = p_employee_id;
  insert into audit_log (actor_app_user_id, action, target_table, target_id, justification)
    values (app_current_app_user_id(), 'dsar_erase', 'employees', p_employee_id, p_justification);
end; $$;

-- Role-gated is_monitored toggle (employees has no client UPDATE policy).
create or replace function public.app_set_monitored(p_employee_id uuid, p_monitored boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_has_role(array['ceo','admin']) then raise exception 'insufficient role'; end if;
  update employees set is_monitored = p_monitored where id = p_employee_id;
  insert into audit_log (actor_app_user_id, action, target_table, target_id, justification)
    values (app_current_app_user_id(), 'change_policy', 'employees', p_employee_id,
            'is_monitored=' || p_monitored::text);
end; $$;

revoke execute on function public.app_dsar_export(uuid)        from public;
revoke execute on function public.app_dsar_erase(uuid, text)   from public;
revoke execute on function public.app_set_monitored(uuid, boolean) from public;
grant  execute on function public.app_dsar_export(uuid)        to authenticated;
grant  execute on function public.app_dsar_erase(uuid, text)   to authenticated;
grant  execute on function public.app_set_monitored(uuid, boolean) to authenticated;
