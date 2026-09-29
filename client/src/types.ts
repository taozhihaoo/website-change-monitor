export type SelectorType = 'css' | 'xpath' | 'text';

export interface Monitor {
  id: string;
  name: string;
  url: string;
  selector: string;
  selector_type: SelectorType;
  check_interval_seconds: number;
  enabled: boolean;
  webhook_url: string | null;
  notify_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonitorWithSummary extends Monitor {
  last_check_at: string | null;
  last_check_status: 'baseline' | 'unchanged' | 'changed' | 'error' | null;
  last_change_at: string | null;
  next_check_at: string | null;
}

export interface Snapshot {
  id: string;
  monitor_id: string;
  content_hash: string;
  content: string;
  checked_at: string;
}

export interface DiffEntry {
  type: 'added' | 'removed';
  value: string;
  count: number;
}

export interface DiffResult {
  added: number;
  removed: number;
  changes: DiffEntry[];
}

export interface Delivery {
  id: string;
  change_event_id: string;
  monitor_id: string;
  provider: string;
  target: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChangeEvent {
  id: string;
  monitor_id: string;
  previous_hash: string;
  current_hash: string;
  previous_content: string;
  current_content: string;
  diff: DiffResult;
  detected_at: string;
  deliveries: Delivery[];
}

export interface CheckRun {
  id: string;
  monitor_id: string;
  triggered_by: 'schedule' | 'manual' | 'test';
  status: 'baseline' | 'unchanged' | 'changed' | 'error';
  error_code: string | null;
  error_message: string | null;
  duration_ms: number;
  started_at: string;
  finished_at: string;
}

export interface Stats {
  total_monitors: number;
  active_monitors: number;
  failed_monitors: number;
  changes_detected: number;
  last_check_at: string | null;
}

export interface TestExtractionResult {
  content: string;
  hash: string;
  duration_ms: number;
}

export interface TestNotificationResult {
  provider: string;
  delivered: boolean;
}
