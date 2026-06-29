# Jurisdiction configuration

Rules and retention can vary by employee location. Sentinel keys this off
`employees.jurisdiction`, `policies.jurisdiction`, and `dlp_rules.jurisdiction_scope`.

## Set an employee's jurisdiction
```sql
update employees set jurisdiction = 'AE' where primary_email = 'user@visionfreights.com';
```

## Per-jurisdiction policy overrides
A `policies` row with a non-null `jurisdiction` overrides the global (`null`) row
for employees in that region. Example — shorter content retention for EU staff:
```sql
insert into policies (policy_key, value_json, jurisdiction)
values ('content_retention_days', '{"value": 30}', 'EU')
on conflict (policy_key, jurisdiction) do update set value_json = excluded.value_json;
```

## Retention guidance (tune with legal)
| Region | Content retention | Metadata retention | Notes |
|---|---|---|---|
| Default | 90 days | 365 days | Conservative baseline |
| EU/UK (GDPR) | ≤ 30 days | ≤ 180 days | Stronger minimization; DPIA mandatory |
| UAE (PDPL) | per policy | per policy | Confirm cross-border transfer rules |

## DLP rule scoping
Restrict a rule to one region by setting `dlp_rules.jurisdiction_scope` (null = all):
```sql
update dlp_rules set jurisdiction_scope = 'EU' where name = 'PII / passport / ID';
```

Retention is enforced by the nightly purge job (added with `pg_cron` in the
scheduling migration); it deletes/redacts `content_class='content'` rows past the
content TTL first, metadata later, and logs each purge to `audit_log`.
