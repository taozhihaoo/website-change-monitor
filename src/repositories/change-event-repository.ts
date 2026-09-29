import type { Db } from '../db/database.js';
import type { ChangeEvent, DiffResult } from '../domain/types.js';
import { withDb } from './with-db.js';

export interface NewChangeEvent {
  id: string;
  monitorId: string;
  previousHash: string;
  currentHash: string;
  previousContent: string;
  currentContent: string;
  diff: DiffResult;
  detectedAt: string;
}

interface ChangeEventRow {
  id: string;
  monitor_id: string;
  previous_hash: string;
  current_hash: string;
  previous_content: string;
  current_content: string;
  diff_json: string;
  detected_at: string;
}

function rowToChangeEvent(row: ChangeEventRow): ChangeEvent {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    previousHash: row.previous_hash,
    currentHash: row.current_hash,
    previousContent: row.previous_content,
    currentContent: row.current_content,
    diff: parseDiff(row.diff_json),
    detectedAt: row.detected_at,
  };
}

function parseDiff(json: string): DiffResult {
  try {
    const parsed = JSON.parse(json) as DiffResult;
    if (
      parsed &&
      typeof parsed.added === 'number' &&
      typeof parsed.removed === 'number' &&
      Array.isArray(parsed.changes)
    ) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return { added: 0, removed: 0, changes: [] };
}

export class ChangeEventRepository {
  constructor(private readonly db: Db) {}

  /**
   * Inserts a change event. Called only when the current hash differs from
   * the previous snapshot's hash, so every call represents a genuinely
   * changed check and must be recorded.
   */
  insert(event: NewChangeEvent): ChangeEvent {
    return withDb('changeEvent.insert', () => {
      this.db
        .prepare(
          `
          INSERT INTO change_events
            (id, monitor_id, previous_hash, current_hash, previous_content, current_content, diff_json, detected_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          event.id,
          event.monitorId,
          event.previousHash,
          event.currentHash,
          event.previousContent,
          event.currentContent,
          JSON.stringify(event.diff),
          event.detectedAt,
        );
      return {
        id: event.id,
        monitorId: event.monitorId,
        previousHash: event.previousHash,
        currentHash: event.currentHash,
        previousContent: event.previousContent,
        currentContent: event.currentContent,
        diff: event.diff,
        detectedAt: event.detectedAt,
      };
    });
  }

  getById(id: string): ChangeEvent | null {
    return withDb('changeEvent.getById', () => {
      const row = this.db.prepare('SELECT * FROM change_events WHERE id = ?').get(id) as
        | ChangeEventRow
        | undefined;
      return row ? rowToChangeEvent(row) : null;
    });
  }

  listByMonitor(monitorId: string, limit: number, offset = 0): ChangeEvent[] {
    return withDb('changeEvent.listByMonitor', () => {
      const rows = this.db
        .prepare(
          `
          SELECT * FROM change_events WHERE monitor_id = ?
          ORDER BY detected_at DESC, rowid DESC LIMIT ? OFFSET ?
        `,
        )
        .all(monitorId, limit, offset) as ChangeEventRow[];
      return rows.map(rowToChangeEvent);
    });
  }

  countAll(): number {
    return withDb('changeEvent.countAll', () => {
      const row = this.db.prepare('SELECT COUNT(*) AS count FROM change_events').get() as {
        count: number;
      };
      return row.count;
    });
  }

  countByMonitor(monitorId: string): number {
    return withDb('changeEvent.countByMonitor', () => {
      const row = this.db
        .prepare('SELECT COUNT(*) AS count FROM change_events WHERE monitor_id = ?')
        .get(monitorId) as { count: number };
      return row.count;
    });
  }
}
