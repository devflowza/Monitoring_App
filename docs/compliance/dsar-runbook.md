# Data-Subject Access & Erasure (DSAR) runbook

Employees may request access to, or erasure of, personal data Sentinel holds.
Handle requests within the statutory window for the employee's jurisdiction.

## 1. Verify & log the request
Confirm the requester's identity. Record the request (date, scope) — and note
that fulfilling it is itself an auditable action.

## 2. Access request — gather the data
Resolve the employee, then export their metadata + any stored flagged content:
```sql
-- the employee + their identities
select * from employees where primary_email = 'user@visionfreights.com';
select * from identities where employee_id = '<employee_id>';

-- email events attributed to them (metadata; content only where stored)
select id, direction, sent_at, subject, content_class, body_ref
from email_events where owner_employee_id = '<employee_id>';

-- alerts, metrics, risk concerning them
select * from alerts where employee_id = '<employee_id>';
select * from risk_scores where scope_type = 'employee' and scope_id = '<employee_id>';
```
Provide the export in a portable format. Redact third-party personal data.

## 3. Erasure / objection
Erasure may be limited by legal-hold or legitimate-interest grounds — assess with
legal first. Where erasure is granted:
```sql
-- stop monitoring this person going forward
update employees set is_monitored = false where id = '<employee_id>';

-- remove stored raw content (keep minimal metadata only if legally required)
update email_events set body_ref = null, content_class = 'metadata'
where owner_employee_id = '<employee_id>' and content_class = 'content';
```
Note: `audit_log` is immutable by design (legal/audit record) and is **not**
erased; document this in your response as a compliance-retention exception.

## 4. Close out
Record completion and the actions taken. If you declined any part, record the
lawful ground for refusal and inform the requester of their escalation rights.
