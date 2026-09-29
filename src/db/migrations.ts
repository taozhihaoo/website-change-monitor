export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Numbered, forward-only migrations embedded in source (so the compiled
 * bundle is self-contained). Each migration runs exactly once, inside a
 * transaction, recorded in schema_migrations.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
      CREATE TABLE monitors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        selector TEXT NOT NULL,
        selector_type TEXT NOT NULL CHECK (selector_type IN ('css', 'xpath', 'text')),
        check_interval_seconds INTEGER NOT NULL CHECK (check_interval_seconds >= 60),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        webhook_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE snapshots (
        id TEXT PRIMARY KEY,
        monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        content_hash TEXT NOT NULL,
        content TEXT NOT NULL,
        checked_at TEXT NOT NULL
      );
      CREATE INDEX idx_snapshots_monitor_checked ON snapshots(monitor_id, checked_at DESC);

      CREATE TABLE change_events (
        id TEXT PRIMARY KEY,
        monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        previous_hash TEXT NOT NULL,
        current_hash TEXT NOT NULL,
        previous_content TEXT NOT NULL,
        current_content TEXT NOT NULL,
        diff_json TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        UNIQUE (monitor_id, current_hash)
      );
      CREATE INDEX idx_change_events_monitor ON change_events(monitor_id, detected_at DESC);

      CREATE TABLE check_runs (
        id TEXT PRIMARY KEY,
        monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        triggered_by TEXT NOT NULL CHECK (triggered_by IN ('schedule', 'manual', 'test')),
        status TEXT NOT NULL CHECK (status IN ('baseline', 'unchanged', 'changed', 'error')),
        error_code TEXT,
        error_message TEXT,
        duration_ms INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL
      );
      CREATE INDEX idx_check_runs_monitor ON check_runs(monitor_id, started_at DESC);

      CREATE TABLE notification_deliveries (
        id TEXT PRIMARY KEY,
        change_event_id TEXT NOT NULL REFERENCES change_events(id) ON DELETE CASCADE,
        monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        target TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_deliveries_event ON notification_deliveries(change_event_id);
      CREATE INDEX idx_deliveries_monitor ON notification_deliveries(monitor_id, created_at DESC);
    `,
  },
];
