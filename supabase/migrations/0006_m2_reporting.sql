-- =============================================================================
-- Sentinel — 0006 Milestone-2: reporting delivery & scope
--   * C1  monthly + monthly-compliance(security) report schedules
--   * C3  dept_manager can read reports scoped to their department
--   * on-demand generation from the UI without exposing the edge secret:
--         a role-gated SECURITY DEFINER wrapper over app_invoke_function
-- Re-runnable.
-- =============================================================================

-- Missing report schedules (only daily/weekly existed). cron.schedule upserts by name.
select cron.schedule('sentinel-report-monthly',  '0 7 1 * *', $$select app_invoke_function('report-generate', '{"type":"monthly"}')$$);
select cron.schedule('sentinel-report-security', '0 8 1 * *', $$select app_invoke_function('report-generate', '{"type":"security"}')$$);

-- C3 — department managers can read reports scoped to their department (they
-- could already read their dept's alerts; reports were previously ceo/admin/analyst only).
drop policy if exists report_read_dept on reports;
create policy report_read_dept on reports for select to authenticated
  using (scope_type = 'department' and scope_id in (select app_managed_department_ids()));

-- On-demand report generation from the dashboard. The edge functions require the
-- shared secret (which the browser must not hold), so route through a role-gated
-- definer that calls app_invoke_function (it sends the secret from Vault).
create or replace function public.app_request_report(p_type text, p_scope_type text default 'org', p_scope_id uuid default null)
returns void language plpgsql security definer set search_path = public, vault as $$
begin
  if not app_has_role(array['ceo','admin','security_analyst']) then
    raise exception 'insufficient role to request a report';
  end if;
  perform app_invoke_function(
    'report-generate',
    jsonb_build_object('type', coalesce(p_type, 'daily'), 'scope_type', coalesce(p_scope_type, 'org'), 'scope_id', p_scope_id)
  );
end; $$;

revoke execute on function public.app_request_report(text, text, uuid) from public;
grant  execute on function public.app_request_report(text, text, uuid) to authenticated;
