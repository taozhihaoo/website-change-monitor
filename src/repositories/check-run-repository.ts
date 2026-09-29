import type { Db } from '../db/database.js';
import type { CheckRun, CheckStatus, CheckTrigger, DashboardStats } from '../domain/types.js';
import { withDb } from './with-db.js';

export interface NewCheckRun {
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

interface CheckRunRow {
  id: string;
  monitor_id: string;
  triggered_by: CheckTrigger;
  status: CheckStatus;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number;
  started_at: string;
  finished_at: string;
}

function rowToCheckRun(row: CheckRunRow): CheckRun {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    triggeredBy: row.triggered_by,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    durationMs: row.duration_ms,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export class CheckRunRepository {
  constructor(private readonly db: Db) {}

  insert(run: NewCheckRun): CheckRun {
    return withDb('checkRun.insert', () => {
      this.db
        .prepare(
          `
          INSERT INTO check_runs
            (id, monitor_id, triggered_by, status, error_code, error_message, duration_ms, started_at, finished_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          run.id,
          run.monitorId,
          run.triggeredBy,
          run.status,
          run.errorCode,
          run.errorMessage,
          run.durationMs,
          run.startedAt,
          run.finishedAt,
        );
      return {
        id: run.id,
        monitorId: run.monitorId,
        triggeredBy: run.triggeredBy,
        status: run.status,
        errorCode: run.errorCode,
        errorMessage: run.errorMessage,
        durationMs: run.durationMs,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
      };
    });
  }

  getById(id: string): CheckRun | null {
    return withDb('checkRun.getById', () => {
      const row = this.db.prepare('SELECT * FROM check_runs WHERE id = ?').get(id) as
        | CheckRunRow
        | undefined;
      return row ? rowToCheckRun(row) : null;
    });
  }

  listByMonitor(monitorId: string, limit: number, offset = 0): CheckRun[] {
    return withDb('checkRun.listByMonitor', () => {
      const rows = this.db
        .prepare(
          `
          SELECT * FROM check_runs WHERE monitor_id = ?
          ORDER BY started_at DESC, rowid DESC LIMIT ? OFFSET ?
        `,
        )
        .all(monitorId, limit, offset) as CheckRunRow[];
      return rows.map(rowToCheckRun);
    });
  }

  latestByMonitor(monitorId: string): CheckRun | null {
    return withDb('checkRun.latestByMonitor', () => {
      const row = this.db
        .prepare(
          'SELECT * FROM check_runs WHERE monitor_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1',
        )
        .get(monitorId) as CheckRunRow | undefined;
      return row ? rowToCheckRun(row) : null;
    });
  }

  latestStartedAt(monitorId: string): string | null {
    return withDb('checkRun.latestStartedAt', () => {
      const row = this.db
        .prepare(
          'SELECT started_at FROM check_runs WHERE monitor_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1',
        )
        .get(monitorId) as { started_at: string } | undefined;
      return row ? row.started_at : null;
    });
  }

  dashboardStats(): DashboardStats {
    return withDb('checkRun.dashboardStats', () => {
      const row = this.db
        .prepare(
          `
          SELECT
            (SELECT COUNT(*) FROM monitors) AS total_monitors,
            (SELECT COUNT(*) FROM monitors WHERE enabled = 1) AS active_monitors,
            (
              SELECT COUNT(*) FROM monitors m
              WHERE (
                SELECT r.status FROM check_runs r WHERE r.monitor_id = m.id
                ORDER BY r.started_at DESC LIMIT 1
              ) = 'error'
            ) AS failed_monitors,
            (SELECT COUNT(*) FROM change_events) AS changes_detected,
            (SELECT MAX(started_at) FROM check_runs) AS last_check_at
        `,
        )
        .get() as {
        total_monitors: number;
        active_monitors: number;
        failed_monitors: number;
        changes_detected: number;
        last_check_at: string | null;
      };
      return {
        totalMonitors: row.total_monitors,
        activeMonitors: row.active_monitors,
        failedMonitors: row.failed_monitors,
        changesDetected: row.changes_detected,
        lastCheckAt: row.last_check_at,
      };
    });
  }
}
