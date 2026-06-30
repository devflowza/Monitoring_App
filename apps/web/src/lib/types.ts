export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface Alert {
  id: string;
  alert_type: string;
  severity: Severity;
  status: 'open' | 'ack' | 'resolved' | 'false_positive';
  title: string;
  summary: string | null;
  occurrence_count: number;
  department_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
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
  metric_key: string;
  metric_value: number;
  scope_type: string;
}
