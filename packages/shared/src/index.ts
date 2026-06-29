// Shared enums & types used across the web app and (conceptually) the edge
// functions. Single source of truth for the small vocabulary the UI renders.

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ALERT_TYPES = [
  'dlp', 'sla_breach', 'exfil', 'external_share', 'personal_email',
  'forwarding_rule', 'finance_delay', 'finance_suspicious',
  'anomaly', 'insider_threat', 'login_anomaly',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ROLES = ['ceo', 'admin', 'dept_manager', 'security_analyst', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0, low: 1, medium: 2, high: 3, critical: 4,
};
