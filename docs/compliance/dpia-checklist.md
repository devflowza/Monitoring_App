# Data Protection Impact Assessment (DPIA) — worksheet

Org-wide monitoring of full email content is high-risk processing and typically
**requires** a DPIA. Complete this with your DPO/legal before go-live.

## 1. Describe the processing
- **What:** Ingestion and AI analysis of email (content + metadata), Drive
  sharing/permissions, calendar, and finance events across all staff accounts.
- **Scope:** All employees with company Workspace accounts in [regions].
- **Volume / frequency:** Continuous, automated (every 10–30 min).
- **Data categories:** Business communications content, sender/recipient
  metadata, attachments, file-sharing events; potentially incidental personal
  data and special-category data.
- **Retention:** content [N] days, metadata [N] days (see jurisdiction-config).

## 2. Necessity & proportionality
- [ ] Lawful basis identified and documented: ______________________
- [ ] Purpose cannot reasonably be achieved by less intrusive means
      (metadata-only? targeted? — justify the full-content choice).
- [ ] Data minimization applied: metadata-first; raw bodies stored only on
      policy match by default (`store_all_bodies = false`).
- [ ] Access limited by RBAC; access logged (audit-of-auditors).
- [ ] Retention limited and enforced by automated purge.

## 3. Risks to individuals
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Over-collection of personal/private content | | | Data-minimization defaults; notice; AUP; per-person `is_monitored` kill-switch |
| Unauthorized access by "watchers" | | | RBAC + immutable audit_log; least privilege |
| Re-identification / profiling harm | | | Transparent risk model; human review of high-impact alerts |
| Secondary use / scope creep | | | Purpose limitation in policy; change control |
| Breach of stored content | | | Encryption; restricted access; short content retention |

## 4. Consultation
- [ ] Employees / representatives informed (notice delivered).
- [ ] DPO advice recorded.
- [ ] Where residual risk remains high, consult the supervisory authority.

## 5. Sign-off
- DPIA owner: __________  Date: ______
- DPO review: __________  Date: ______
- Approved to activate (`monitoring_active = true`): ☐ yes  ☐ no

Re-review on material change (new data sources, new purposes, jurisdiction
changes) and at least annually.
