import type {
  ChangeEvent,
  CheckRun,
  Monitor,
  MonitorWithSummary,
  NotificationDelivery,
  Snapshot,
} from '../domain/types.js';

// The REST API and webhook payloads use snake_case (matches the documented
// data model); internal TypeScript types stay camelCase.

export function serializeMonitor(monitor: Monitor): Record<string, unknown> {
  return {
    id: monitor.id,
    name: monitor.name,
    url: monitor.url,
    selector: monitor.selector,
    selector_type: monitor.selectorType,
    check_interval_seconds: monitor.checkIntervalSeconds,
    enabled: monitor.enabled,
    webhook_url: monitor.webhookUrl,
    created_at: monitor.createdAt,
    updated_at: monitor.updatedAt,
  };
}

export function serializeMonitorWithSummary(
  monitor: MonitorWithSummary,
): Record<string, unknown> {
  return {
    ...serializeMonitor(monitor),
    last_check_at: monitor.lastCheckAt,
    last_check_status: monitor.lastCheckStatus,
    last_change_at: monitor.lastChangeAt,
    next_check_at: monitor.nextCheckAt,
  };
}

export function serializeSnapshot(snapshot: Snapshot): Record<string, unknown> {
  return {
    id: snapshot.id,
    monitor_id: snapshot.monitorId,
    content_hash: snapshot.contentHash,
    content: snapshot.content,
    checked_at: snapshot.checkedAt,
  };
}

export function serializeChangeEvent(event: ChangeEvent): Record<string, unknown> {
  return {
    id: event.id,
    monitor_id: event.monitorId,
    previous_hash: event.previousHash,
    current_hash: event.currentHash,
    previous_content: event.previousContent,
    current_content: event.currentContent,
    diff: event.diff,
    detected_at: event.detectedAt,
  };
}

export function serializeCheckRun(run: CheckRun): Record<string, unknown> {
  return {
    id: run.id,
    monitor_id: run.monitorId,
    triggered_by: run.triggeredBy,
    status: run.status,
    error_code: run.errorCode,
    error_message: run.errorMessage,
    duration_ms: run.durationMs,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
  };
}

export function serializeDelivery(delivery: NotificationDelivery): Record<string, unknown> {
  return {
    id: delivery.id,
    change_event_id: delivery.changeEventId,
    monitor_id: delivery.monitorId,
    provider: delivery.provider,
    target: delivery.target,
    status: delivery.status,
    attempts: delivery.attempts,
    last_error: delivery.lastError,
    created_at: delivery.createdAt,
    updated_at: delivery.updatedAt,
  };
}
