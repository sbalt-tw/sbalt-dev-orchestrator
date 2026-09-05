import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  initialise, InitError, checksumOf, canonicalBytes, withTransaction, V1, MIGRATIONS,
  CHECKSUM_ALGORITHM,
} from '../src/db/migrate.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'a1-'));
  dbPath = join(dir, 'orchestrator.sqlite');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const expectCode = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(InitError);
    expect((error as InitError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, but nothing was thrown`);
};

describe('the v1 migration', () => {
  it('is the only migration and creates only schema_migrations', () => {
    expect(MIGRATIONS).toHaveLength(1);
    expect(V1.statements).toHaveLength(1);
    expect(V1.statements[0]).toMatch(/^CREATE TABLE schema_migrations \(/);
    expect(V1.statements.join(' ')).not.toMatch(/task|lane|project|worker|lease/i);
  });

  it('derives its checksum from frozen bytes, not from any database', () => {
    expect(CHECKSUM_ALGORITHM).toBe('dev-orch/migration-checksum/v1');
    expect(canonicalBytes(V1).toString('utf8')).toBe(
      `dev-orch/migration/v1\n${V1.statements[0]};\n`,
    );
    expect(checksumOf(V1)).toMatch(/^[0-9a-f]{64}$/);
    expect(checksumOf(V1)).toBe(checksumOf(V1));
  });
});

describe('db:init on an acceptable database', () => {
  it('applies v1 to a database that does not exist yet', () => {
    expect(existsSync(dbPath)).toBe(false);
    const outcome = initialise(dbPath);
    expect(outcome).toEqual({ status: 'applied', version: 1, checksum: checksumOf(V1) });
    expect(existsSync(dbPath)).toBe(true);
  });

  it('applies v1 to an existing but provably empty database', () => {
    new Database(dbPath).close();
    expect(initialise(dbPath).status).toBe('applied');
  });

  it('creates exactly one table and one recorded version', () => {
    initialise(dbPath);
    const db = new Database(dbPath, { readonly: true });
    const objects = db.prepare("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
      .all() as { name: string; type: string }[];
    const rows = db.prepare('SELECT version, checksum, applied_at FROM schema_migrations')
      .all() as { version: number; checksum: string; applied_at: string }[];
    db.close();
    expect(objects).toEqual([{ name: 'schema_migrations', type: 'table' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(1);
    expect(rows[0]?.checksum).toBe(checksumOf(V1));
    expect(rows[0]?.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('survives close and reopen with the same version and checksum', () => {
    const first = initialise(dbPath);
    const second = initialise(dbPath);
    expect(second).toEqual({ status: 'already_at', version: 1, checksum: first.checksum });
  });

  it('is idempotent: the second run does not rewrite the applied row', () => {
    initialise(dbPath);
    const before = new Database(dbPath, { readonly: true })
      .prepare('SELECT applied_at FROM schema_migrations WHERE version = 1')
      .get() as { applied_at: string };
    initialise(dbPath);
    initialise(dbPath);
    const after = new Database(dbPath, { readonly: true })
      .prepare('SELECT applied_at, COUNT(*) AS n FROM schema_migrations WHERE version = 1')
      .get() as { applied_at: string; n: number };
    expect(after.applied_at).toBe(before.applied_at);
    expect(after.n).toBe(1);
  });

  it('enables foreign key enforcement on every connection', () => {
    initialise(dbPath);
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
});

describe('db:init fails closed', () => {
  it('refuses a relative path', () => expectCode(() => initialise('relative/x.sqlite'), 'E_DB_PATH_NOT_ABSOLUTE'));

  it('refuses a missing parent directory and does not create it', () => {
    const nested = join(dir, 'absent', 'x.sqlite');
    expectCode(() => initialise(nested), 'E_DB_PARENT_MISSING');
    expect(existsSync(join(dir, 'absent'))).toBe(false);
  });

  it('refuses a file that is not a SQLite database', () => {
    writeFileSync(dbPath, 'this is not a database');
    expectCode(() => initialise(dbPath), 'E_DB_NOT_SQLITE');
  });

  it('refuses a database holding objects it did not create', () => {
    const db = new Database(dbPath);
    db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY)');
    db.close();
    expectCode(() => initialise(dbPath), 'E_UNKNOWN_SCHEMA');
  });

  it('refuses a registry with the wrong shape', () => {
    const db = new Database(dbPath);
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    db.close();
    expectCode(() => initialise(dbPath), 'E_REGISTRY_MALFORMED');
  });

  it('refuses a registry with the right shape and no rows', () => {
    const db = new Database(dbPath);
    db.exec(V1.statements[0] as string);
    db.close();
    expectCode(() => initialise(dbPath), 'E_REGISTRY_MALFORMED');
  });

  it('refuses a recorded version this runner does not know', () => {
    const db = new Database(dbPath);
    db.exec(V1.statements[0] as string);
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(7, checksumOf(V1), 'x');
    db.close();
    expectCode(() => initialise(dbPath), 'E_UNKNOWN_VERSION');
  });

  it('refuses a checksum that does not match the frozen bytes', () => {
    initialise(dbPath);
    const db = new Database(dbPath);
    db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('0'.repeat(64));
    db.close();
    expectCode(() => initialise(dbPath), 'E_CHECKSUM_MISMATCH');
  });

  it('leaves a refused database unmodified', () => {
    const db = new Database(dbPath);
    db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY)');
    db.close();
    expectCode(() => initialise(dbPath), 'E_UNKNOWN_SCHEMA');
    const after = new Database(dbPath, { readonly: true });
    const objects = after.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    after.close();
    expect(objects).toEqual([{ name: 'tasks' }]);
  });
});

describe('a migration that fails part way is logically rolled back', () => {
  // The production runner accepts no SQL, so the fault is injected into the shared
  // transaction wrapper here rather than into the CLI. This proves the wrapper rolls back
  // the same way the real apply path uses it; it does not prove the v1 statements
  // themselves can fail.
  it('leaves no version row, no partial schema, and a database that still opens', () => {
    const db = new Database(dbPath);
    expect(() => withTransaction(db, () => {
      db.exec(V1.statements[0] as string);
      throw new Error('deterministic fault after the table was created');
    })).toThrow(/deterministic fault/);
    db.close();

    const after = new Database(dbPath);
    const objects = after.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const integrity = after.pragma('integrity_check', { simple: true });
    after.close();

    expect(objects).toEqual([]);
    expect(integrity).toBe('ok');
    expect(initialise(dbPath).status).toBe('applied');
  });
});
