-- =============================================================================
-- Sentinel — 0009 Milestone-3: detection intelligence
--   * A1  competitor-contact: wire the dead is_competitor flag + risk factor
--   * F5  DLP false-positive feedback loop: persist every match + rule stats
-- Re-runnable.
-- =============================================================================

-- A1 — competitor_contact alert type + a domains policy + a flag-sync function.
alter type alert_type add value if not exists 'competitor_contact';

insert into policies (policy_key, value_json) values
  ('competitor_domains', '{"value": []}')
on conflict (policy_key, jurisdiction) do nothing;

-- Set identities.is_competitor from the competitor_domains policy (domains are the
-- source of truth). Called by analyze before competitor detection.
create or replace function public.app_sync_competitor_flags()
returns void language plpgsql security definer set search_path = public as $$
declare domains text[];
begin
  select coalesce(array(select lower(jsonb_array_elements_text(value_json->'value'))), '{}')
    into domains
    from policies where policy_key = 'competitor_domains' and jurisdiction is null;
  update identities
     set is_competitor = (array_length(domains, 1) is not null
                          and split_part(lower(value), '@', 2) = any(domains));
end; $$;
revoke execute on function public.app_sync_competitor_flags() from public;
grant  execute on function public.app_sync_competitor_flags() to service_role;

-- F5 — persist every DLP match (not just the top) so precision/recall and
-- rule tuning become possible, and triage outcomes can flow back to rules.
create table if not exists dlp_matches (
  id             uuid primary key default gen_random_uuid(),
  email_event_id uuid references email_events(id) on delete cascade,
  rule_id        uuid,
  category       text,
  matched_on     text,
  excerpt        text,
  escalated      boolean not null default false,
  verdict_json   jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists dlp_matches_event_idx on dlp_matches (email_event_id);
create index if not exists dlp_matches_rule_idx  on dlp_matches (rule_id);
create unique index if not exists dlp_matches_dedup_uidx
  on dlp_matches (email_event_id, rule_id, matched_on) nulls not distinct;

alter table dlp_matches enable row level security;
drop policy if exists dlp_matches_read on dlp_matches;
create policy dlp_matches_read on dlp_matches for select to authenticated
  using (app_has_role(array['ceo','admin','security_analyst']));

-- Per-rule performance: fired / confirmed / false-positive counts + FP rate.
-- security_invoker so the caller's RLS on alerts/dlp_rules applies.
create or replace view dlp_rule_stats
with (security_invoker = true) as
select r.id as rule_id, r.name, r.category,
  count(a.id)                                            as fired,
  count(a.id) filter (where a.status = 'false_positive') as false_positives,
  count(a.id) filter (where a.status = 'resolved')       as resolved,
  case when count(a.id) > 0
    then round(count(a.id) filter (where a.status = 'false_positive')::numeric / count(a.id), 2)
    else 0 end                                           as fp_rate
from dlp_rules r
left join alerts a on a.rule_id = r.id
group by r.id, r.name, r.category;
