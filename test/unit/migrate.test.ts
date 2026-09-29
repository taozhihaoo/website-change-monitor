import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../../src/db/database.js';
import { migrate } from '../../src/db/migrate.js';
import { MIGRATIONS } from '../../src/db/migrations.js';

describe('migrations', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates all expected tables', () => {
    migrate(db);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    for (const table of [
      'monitors',
      'snapshots',
      'change_events',
      'check_runs',
      'notification_deliveries',
      'schema_migrations',
    ]) {
      expect(tables, table).toContain(table);
    }
  });

  it('records applied migration versions', () => {
    migrate(db);
    const versions = (
      db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
        version: number;
      }>
    ).map((row) => row.version);
    expect(versions).toEqual(MIGRATIONS.map((migration) => migration.version));
  });

  it('is idempotent (running twice applies nothing new)', () => {
    migrate(db);
    expect(() => migrate(db)).not.toThrowError();
    const count = (
      db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }
    ).count;
    expect(count).toBe(MIGRATIONS.length);
  });

  it('enforces the documented schema constraints', () => {
    migrate(db);
    const insertMonitor = db.prepare(
      `INSERT INTO monitors (id, name, url, selector, selector_type, check_interval_seconds, enabled, webhook_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();

    // invalid selector_type
    expect(() =>
      insertMonitor.run('m1', 'n', 'https://example.com', '.a', 'regex', 300, 1, null, now, now),
    ).toThrowError();
    // interval below the 60s floor
    expect(() =>
      insertMonitor.run('m2', 'n', 'https://example.com', '.a', 'css', 30, 1, null, now, now),
    ).toThrowError();
    // valid insert
    expect(() =>
      insertMonitor.run('m3', 'n', 'https://example.com', '.a', 'css', 300, 1, null, now, now),
    ).not.toThrowError();

    // change_events allows revisiting the same content state (no
    // UNIQUE(monitor_id, current_hash) — A→B→A→B is legitimate history)
    const insertEvent = db.prepare(
      `INSERT INTO change_events (id, monitor_id, previous_hash, current_hash, previous_content, current_content, diff_json, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertEvent.run('e1', 'm3', 'a', 'b', 'x', 'y', '{}', now);
    expect(() => insertEvent.run('e2', 'm3', 'a', 'b', 'x', 'y', '{}', now)).not.toThrowError();
    // same hash under a different monitor is fine
    insertMonitor.run('m4', 'n', 'https://example.com', '.a', 'css', 300, 1, null, now, now);
    expect(() => insertEvent.run('e3', 'm4', 'a', 'b', 'x', 'y', '{}', now)).not.toThrowError();
  });

  it('migration 2 rebuilds change_events: data preserved, UNIQUE constraint removed', () => {
    // start from v1 only, seed data through the v1 schema (with UNIQUE).
    // schema_migrations is maintained by migrate() itself, so create it here
    // to simulate "v1 already applied".
    const v1 = MIGRATIONS[0];
    expect(v1?.version).toBe(1);
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    db.exec(v1?.sql ?? '');
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(
      new Date().toISOString(),
    );
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO monitors (id, name, url, selector, selector_type, check_interval_seconds, enabled, webhook_url, created_at, updated_at)
       VALUES ('m1', 'n', 'https://example.com', '.a', 'css', 300, 1, NULL, ?, ?)`,
    ).run(now, now);
    const insertEvent = db.prepare(
      `INSERT INTO change_events (id, monitor_id, previous_hash, current_hash, previous_content, current_content, diff_json, detected_at)
       VALUES (?, 'm1', 'a', 'b', 'x', 'y', '{}', ?)`,
    );
    insertEvent.run('e1', now);
    // under v1 the same (monitor_id, current_hash) was rejected
    expect(() => insertEvent.run('e2', now)).toThrowError();

    // apply everything that is still pending (v2)
    migrate(db);

    // existing data survived the table rebuild
    const rows = db.prepare('SELECT id FROM change_events ORDER BY id').all() as Array<{
      id: string;
    }>;
    expect(rows.map((row) => row.id)).toEqual(['e1']);
    // and the same content state can now be recorded again
    expect(() => insertEvent.run('e3', now)).not.toThrowError();
    // the query index was recreated
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'change_events'")
      .all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toContain('idx_change_events_monitor');
  });

  it('cascade-deletes dependents when a monitor is removed', () => {
    migrate(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO monitors (id, name, url, selector, selector_type, check_interval_seconds, enabled, webhook_url, created_at, updated_at)
       VALUES ('m1', 'n', 'https://example.com', '.a', 'css', 300, 1, NULL, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO snapshots (id, monitor_id, content_hash, content, checked_at)
       VALUES ('s1', 'm1', 'h', 'c', ?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO change_events (id, monitor_id, previous_hash, current_hash, previous_content, current_content, diff_json, detected_at)
       VALUES ('e1', 'm1', 'a', 'b', 'x', 'y', '{}', ?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO notification_deliveries (id, change_event_id, monitor_id, provider, target, status, attempts, last_error, created_at, updated_at)
       VALUES ('d1', 'e1', 'm1', 'mock', 'mock', 'sent', 1, NULL, ?, ?)`,
    ).run(now, now);

    db.prepare('DELETE FROM monitors WHERE id = ?').run('m1');

    const count = (table: string): number =>
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
    expect(count('snapshots')).toBe(0);
    expect(count('change_events')).toBe(0);
    expect(count('notification_deliveries')).toBe(0);
  });
});
