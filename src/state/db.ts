/**
 * SQLite connection and migration runner.
 *
 * Library choice: `better-sqlite3`.
 *   - Synchronous API, which makes "read state, decide, write state" a single
 *     uninterrupted transaction. That is exactly the shape a scheduler tick
 *     needs, and it removes a whole class of interleaving bugs.
 *   - Real transactions with rollback, so a crash mid-tick cannot leave half a
 *     dispatch behind.
 *   - Ships prebuilt binaries for common platforms, so `npm install` works on a
 *     developer machine without a toolchain.
 *   - Rejected `node:sqlite`: it is still flagged experimental and its API may
 *     change between Node releases, which is the wrong foundation for durable
 *     team infrastructure. The driver surface used here is small, so swapping
 *     later is contained to this file.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MIGRATIONS } from './schema.js';

export type Db = Database.Database;

export const DEFAULT_DB_PATH = '.dev-orch/state.sqlite';

export function resolveDbPath(explicit?: string): string {
  const raw = explicit ?? process.env.DEV_ORCH_DB_PATH ?? DEFAULT_DB_PATH;
  return raw === ':memory:' ? raw : resolve(raw);
}

export function openDatabase(path?: string): Db {
  const dbPath = resolveDbPath(path);
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );`);

  const applied = new Set(
    db
      .prepare<[], { version: number }>('SELECT version FROM schema_migrations')
      .all()
      .map((row) => row.version),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, new Date().toISOString());
    });
    run();
  }
}

export function appliedMigrations(db: Db): Array<{ version: number; name: string }> {
  return db
    .prepare<[], { version: number; name: string }>(
      'SELECT version, name FROM schema_migrations ORDER BY version',
    )
    .all();
}
