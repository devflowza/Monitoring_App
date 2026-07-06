export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type AlertStatus = 'open' | 'ack' | 'resolved' | 'false_positive';

export interface Alert {
  id: string;
  alert_type: string;
  severity: Severity;
  status: AlertStatus;
  title: string;
  summary: string | null;
  occurrence_count: number;
  employee_id: string | null;
  department_id: string | null;
  source_event_table: string | null;
  source_event_id: string | null;
  evidence_json: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  assigned_to?: string | null;
  dispatch_status?: string | null;
}

export interface AlertNote {
  id: string;
  alert_id: string;
  author_app_user_id: string | null;
  note: string;
  created_at: string;
}

export interface RevealedContent {
  subject: string | null;
  snippet: string | null;
  body: string | null;
}

export interface Source {
  id: string;
  kind: string;
  mode: string;
  display_name: string;
  is_active: boolean;
}

export interface SyncState {
  source_id: string;
  cursor: string | null;
  last_run_at: string | null;
  last_status: string | null;
  error_detail: string | null;
  updated_at: string;
}

export interface JobRun {
  id: string;
  function_name: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  records_processed: number | null;
  alerts_raised: number | null;
  error_detail: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  target_table: string | null;
  accessed_content_class: string | null;
  justification: string | null;
  occurred_at: string;
}

export interface MetricRow {
  metric_date: string;
  scope_type: string;
  scope_id: string | null;
  metric_key: string;
  metric_value: number;
}

export interface RiskScore {
  id: string;
  scope_type: string;
  scope_id: string | null;
  score_date: string;
  total_score: number;
  tier: string;
  trend_vs_prev: number | null;
  component_breakdown_json: Record<string, { value: number; weight: number; contribution: number }>;
}

export interface FinanceEvent {
  id: string;
  object_type: string;
  status: string | null;
  counterparty: string | null;
  amount: number | null;
  currency: string | null;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  is_suspicious: boolean;
}

export interface Report {
  id: string;
  report_type: string;
  period_start: string | null;
  period_end: string | null;
  narrative_md: string | null;
  status: string;
  created_at: string;
}

export interface Employee {
  id: string;
  full_name: string;
  primary_email: string;
  department_id: string | null;
  employment_status: string;
}

export interface DlpRule {
  id: string;
  name: string;
  category: string;
  match_type: string;
  pattern: string;
  severity_weight: number;
  is_active: boolean;
}

export interface SlaRule {
  id: string;
  department_id: string | null;
  rule_type: string;
  threshold_minutes: number;
  is_active: boolean;
}

export interface RiskWeight {
  id: string;
  factor_key: string;
  weight: number;
  description: string | null;
}

export interface Policy {
  policy_key: string;
  value_json: { value?: unknown } & Record<string, unknown>;
}
