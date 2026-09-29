import type { Db } from './database.js';
import { MIGRATIONS } from './migrations.js';

/**
 * Applies all pending migrations. Each runs inside a transaction together
 * with its schema_migrations bookkeeping row, so a failed migration never
 * leaves the schema half-applied.
 */
export function migrate(db: Db, log?: (message: { version: number; name: string }) => void): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{
    version: number;
  }>;
  const applied = new Set(appliedRows.map((row) => row.version));

  const insertApplied = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      insertApplied.run(migration.version, new Date().toISOString());
    });
    apply();
    log?.({ version: migration.version, name: migration.name });
  }
}
