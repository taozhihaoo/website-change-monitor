import type { Db } from '../db/database.js';
import type { CheckStatus, Monitor, MonitorWithSummary, SelectorType } from '../domain/types.js';
import { withDb } from './with-db.js';

export interface NewMonitor {
  id: string;
  name: string;
  url: string;
  selector: string;
  selectorType: SelectorType;
  checkIntervalSeconds: number;
  enabled: boolean;
  webhookUrl: string | null;
  notifyEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorPatch {
  name?: string;
  url?: string;
  selector?: string;
  selectorType?: SelectorType;
  checkIntervalSeconds?: number;
  enabled?: boolean;
  webhookUrl?: string | null;
  notifyEmail?: string | null;
}

interface MonitorRow {
  id: string;
  name: string;
  url: string;
  selector: string;
  selector_type: SelectorType;
  check_interval_seconds: number;
  enabled: 0 | 1;
  webhook_url: string | null;
  notify_email: string | null;
  created_at: string;
  updated_at: string;
}

interface MonitorSummaryRow extends MonitorRow {
  last_check_at: string | null;
  last_check_status: CheckStatus | null;
  last_change_at: string | null;
}

function rowToMonitor(row: MonitorRow): Monitor {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    selector: row.selector,
    selectorType: row.selector_type,
    checkIntervalSeconds: row.check_interval_seconds,
    enabled: row.enabled === 1,
    webhookUrl: row.webhook_url,
    notifyEmail: row.notify_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMonitorWithSummary(row: MonitorSummaryRow): MonitorWithSummary {
  const monitor = rowToMonitor(row);
  const lastCheckAt = row.last_check_at;
  return {
    ...monitor,
    lastCheckAt,
    lastCheckStatus: row.last_check_status,
    lastChangeAt: row.last_change_at,
    nextCheckAt:
      monitor.enabled && lastCheckAt !== null
        ? new Date(Date.parse(lastCheckAt) + monitor.checkIntervalSeconds * 1000).toISOString()
        : null,
  };
}

const SUMMARY_SELECT = `
  SELECT
    m.*,
    (
      SELECT r.started_at FROM check_runs r WHERE r.monitor_id = m.id
      ORDER BY r.started_at DESC LIMIT 1
    ) AS last_check_at,
    (
      SELECT r.status FROM check_runs r WHERE r.monitor_id = m.id
      ORDER BY r.started_at DESC LIMIT 1
    ) AS last_check_status,
    (
      SELECT MAX(ce.detected_at) FROM change_events ce WHERE ce.monitor_id = m.id
    ) AS last_change_at
  FROM monitors m
`;

export class MonitorRepository {
  constructor(private readonly db: Db) {}

  create(monitor: NewMonitor): Monitor {
    return withDb('monitor.create', () => {
      this.db
        .prepare(
          `
          INSERT INTO monitors
            (id, name, url, selector, selector_type, check_interval_seconds, enabled, webhook_url, notify_email, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          monitor.id,
          monitor.name,
          monitor.url,
          monitor.selector,
          monitor.selectorType,
          monitor.checkIntervalSeconds,
          monitor.enabled ? 1 : 0,
          monitor.webhookUrl,
          monitor.notifyEmail,
          monitor.createdAt,
          monitor.updatedAt,
        );
      return this.getOrThrow(monitor.id);
    });
  }

  getById(id: string): Monitor | null {
    return withDb('monitor.getById', () => {
      const row = this.db.prepare('SELECT * FROM monitors WHERE id = ?').get(id) as
        | MonitorRow
        | undefined;
      return row ? rowToMonitor(row) : null;
    });
  }

  list(): Monitor[] {
    return withDb('monitor.list', () => {
      const rows = this.db
        .prepare('SELECT * FROM monitors ORDER BY created_at DESC')
        .all() as MonitorRow[];
      return rows.map(rowToMonitor);
    });
  }

  listEnabled(): Monitor[] {
    return withDb('monitor.listEnabled', () => {
      const rows = this.db
        .prepare('SELECT * FROM monitors WHERE enabled = 1 ORDER BY created_at ASC')
        .all() as MonitorRow[];
      return rows.map(rowToMonitor);
    });
  }

  listWithSummary(): MonitorWithSummary[] {
    return withDb('monitor.listWithSummary', () => {
      const rows = this.db
        .prepare(`${SUMMARY_SELECT} ORDER BY m.created_at DESC`)
        .all() as MonitorSummaryRow[];
      return rows.map(rowToMonitorWithSummary);
    });
  }

  getByIdWithSummary(id: string): MonitorWithSummary | null {
    return withDb('monitor.getByIdWithSummary', () => {
      const row = this.db.prepare(`${SUMMARY_SELECT} WHERE m.id = ?`).get(id) as
        | MonitorSummaryRow
        | undefined;
      return row ? rowToMonitorWithSummary(row) : null;
    });
  }

  update(id: string, patch: MonitorPatch, updatedAt: string): Monitor | null {
    return withDb('monitor.update', () => {
      const assignments: string[] = [];
      const values: unknown[] = [];

      if (patch.name !== undefined) {
        assignments.push('name = ?');
        values.push(patch.name);
      }
      if (patch.url !== undefined) {
        assignments.push('url = ?');
        values.push(patch.url);
      }
      if (patch.selector !== undefined) {
        assignments.push('selector = ?');
        values.push(patch.selector);
      }
      if (patch.selectorType !== undefined) {
        assignments.push('selector_type = ?');
        values.push(patch.selectorType);
      }
      if (patch.checkIntervalSeconds !== undefined) {
        assignments.push('check_interval_seconds = ?');
        values.push(patch.checkIntervalSeconds);
      }
      if (patch.enabled !== undefined) {
        assignments.push('enabled = ?');
        values.push(patch.enabled ? 1 : 0);
      }
      if (patch.webhookUrl !== undefined) {
        assignments.push('webhook_url = ?');
        values.push(patch.webhookUrl);
      }
      if (patch.notifyEmail !== undefined) {
        assignments.push('notify_email = ?');
        values.push(patch.notifyEmail);
      }

      if (assignments.length === 0) {
        return this.getById(id);
      }

      assignments.push('updated_at = ?');
      values.push(updatedAt);
      values.push(id);

      const result = this.db
        .prepare(`UPDATE monitors SET ${assignments.join(', ')} WHERE id = ?`)
        .run(...values);
      if (result.changes === 0) {
        return null;
      }
      return this.getOrThrow(id);
    });
  }

  delete(id: string): boolean {
    return withDb('monitor.delete', () => {
      const result = this.db.prepare('DELETE FROM monitors WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  private getOrThrow(id: string): Monitor {
    const monitor = this.getById(id);
    if (monitor === null) {
      throw new Error(`Monitor ${id} disappeared after write`);
    }
    return monitor;
  }
}
