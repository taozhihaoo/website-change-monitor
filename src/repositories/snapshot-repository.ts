import type { Db } from '../db/database.js';
import type { Snapshot } from '../domain/types.js';
import { withDb } from './with-db.js';

export interface NewSnapshot {
  id: string;
  monitorId: string;
  contentHash: string;
  content: string;
  checkedAt: string;
}

interface SnapshotRow {
  id: string;
  monitor_id: string;
  content_hash: string;
  content: string;
  checked_at: string;
}

function rowToSnapshot(row: SnapshotRow): Snapshot {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    contentHash: row.content_hash,
    content: row.content,
    checkedAt: row.checked_at,
  };
}

export class SnapshotRepository {
  constructor(private readonly db: Db) {}

  insert(snapshot: NewSnapshot): Snapshot {
    return withDb('snapshot.insert', () => {
      this.db
        .prepare(
          `
          INSERT INTO snapshots (id, monitor_id, content_hash, content, checked_at)
          VALUES (?, ?, ?, ?, ?)
        `,
        )
        .run(
          snapshot.id,
          snapshot.monitorId,
          snapshot.contentHash,
          snapshot.content,
          snapshot.checkedAt,
        );
      return {
        id: snapshot.id,
        monitorId: snapshot.monitorId,
        contentHash: snapshot.contentHash,
        content: snapshot.content,
        checkedAt: snapshot.checkedAt,
      };
    });
  }

  latestByMonitor(monitorId: string): Snapshot | null {
    return withDb('snapshot.latestByMonitor', () => {
      const row = this.db
        .prepare(
          'SELECT * FROM snapshots WHERE monitor_id = ? ORDER BY checked_at DESC, rowid DESC LIMIT 1',
        )
        .get(monitorId) as SnapshotRow | undefined;
      return row ? rowToSnapshot(row) : null;
    });
  }

  listByMonitor(monitorId: string, limit: number): Snapshot[] {
    return withDb('snapshot.listByMonitor', () => {
      const rows = this.db
        .prepare(
          'SELECT * FROM snapshots WHERE monitor_id = ? ORDER BY checked_at DESC, rowid DESC LIMIT ?',
        )
        .all(monitorId, limit) as SnapshotRow[];
      return rows.map(rowToSnapshot);
    });
  }

  countByMonitor(monitorId: string): number {
    return withDb('snapshot.countByMonitor', () => {
      const row = this.db
        .prepare('SELECT COUNT(*) AS count FROM snapshots WHERE monitor_id = ?')
        .get(monitorId) as { count: number };
      return row.count;
    });
  }

  /**
   * Deletes the oldest snapshots beyond `keep` (newest-first ordering as used
   * by latestByMonitor). The latest snapshot is always retained. Change
   * events are untouched — they carry their own content copies.
   */
  pruneToLimit(monitorId: string, keep: number): number {
    return withDb('snapshot.pruneToLimit', () => {
      if (keep <= 0) {
        return 0;
      }
      const result = this.db
        .prepare(
          `
          DELETE FROM snapshots
          WHERE monitor_id = ?
            AND id NOT IN (
              SELECT id FROM snapshots WHERE monitor_id = ?
              ORDER BY checked_at DESC, rowid DESC LIMIT ?
            )
        `,
        )
        .run(monitorId, monitorId, keep);
      return result.changes;
    });
  }
}
