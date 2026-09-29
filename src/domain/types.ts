export type SelectorType = 'css' | 'xpath' | 'text';

export type CheckTrigger = 'schedule' | 'manual' | 'test';

export type CheckStatus = 'baseline' | 'unchanged' | 'changed' | 'error';

export interface Monitor {
  id: string;
  name: string;
  url: string;
  selector: string;
  selectorType: SelectorType;
  checkIntervalSeconds: number;
  enabled: boolean;
  webhookUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorSummary {
  lastCheckAt: string | null;
  lastCheckStatus: CheckStatus | null;
  lastChangeAt: string | null;
}

export interface MonitorWithSummary extends Monitor, MonitorSummary {
  /** ISO timestamp of the next scheduled check, or null when disabled / never derivable. */
  nextCheckAt: string | null;
}

export interface Snapshot {
  id: string;
  monitorId: string;
  contentHash: string;
  content: string;
  checkedAt: string;
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

export interface ChangeEvent {
  id: string;
  monitorId: string;
  previousHash: string;
  currentHash: string;
  previousContent: string;
  currentContent: string;
  diff: DiffResult;
  detectedAt: string;
}

export interface CheckRun {
  id: string;
  monitorId: string;
  triggeredBy: CheckTrigger;
  status: CheckStatus;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
}

export type DeliveryStatus = 'pending' | 'sent' | 'failed';

export interface NotificationDelivery {
  id: string;
  changeEventId: string;
  monitorId: string;
  provider: string;
  target: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardStats {
  totalMonitors: number;
  activeMonitors: number;
  failedMonitors: number;
  changesDetected: number;
  lastCheckAt: string | null;
}
