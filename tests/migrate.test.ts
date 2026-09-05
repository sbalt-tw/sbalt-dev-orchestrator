import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  initialise, InitError, canonicalBytes, checksumOf,
  CHECKSUM_ALGORITHM, V1, V1_CHECKSUM, V1_CREATE,
} from '../src/db/migrate.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'a1-'));
  dbPath = join(dir, 'orchestrator.sqlite');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Digest of the target file, so "unmodified" is asserted over bytes, not over table names. */
const digest = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
const entries = (): string[] => readdirSync(dir).sort();

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(InitError);
    expect((error as InitError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, but the call returned normally`);
}

/** Writes a database with an arbitrary schema, then closes it, leaving no sidecars. */
function seed(path: string, statements: readonly string[]): void {
  const db = new Database(path);
  for (const statement of statements) db.exec(statement);
  db.close();
}

const REGISTRY_ROW = "INSERT INTO schema_migrations VALUES (1, '" + V1_CHECKSUM + "', '2026-01-01T00:00:00.000Z')";

describe('checksum identity', () => {
  // The expected value is written here as a literal. It is not derived from V1, so editing
  // V1's bytes fails this test instead of silently redefining the released identity.
  it('matches the frozen golden for version 1', () => {
    expect(checksumOf(V1)).toBe('f2e2aa4ad993a7b4562db35e1e1196dd4843470440e36b942dc87843ef6782c8');
    expect(V1_CHECKSUM).toBe('f2e2aa4ad993a7b4562db35e1e1196dd4843470440e36b942dc87843ef6782c8');
  });

  it('pins the exact v1 statement text', () => {
    expect(V1.statements).toEqual([V1_CREATE]);
    expect(V1_CREATE).toBe(
      'CREATE TABLE schema_migrations (\n'
      + '  version INTEGER PRIMARY KEY,\n'
      + '  checksum TEXT NOT NULL,\n'
      + '  applied_at TEXT NOT NULL\n'
      + ')',
    );
  });

  it('carries the algorithm identity and a length prefix inside the preimage', () => {
    const preimage = canonicalBytes(V1).toString('utf8');
    expect(preimage.startsWith(`${CHECKSUM_ALGORITHM}\n`)).toBe(true);
    expect(preimage).toContain(`len:${Buffer.byteLength(V1_CREATE, 'utf8')}\n`);
  });

  it('separates the sequences that the ";\\n" scheme made identical', () => {
    const a = { version: 1, statements: ['SELECT 1 --', 'SELECT 2'] };
    const b = { version: 1, statements: ['SELECT 1 --;\nSELECT 2'] };
    expect(a.statements.join(';\n')).toBe(b.statements.join(';\n')); // the old collision
    expect(checksumOf(a)).not.toBe(checksumOf(b));
  });

  it('separates migrations that differ only in version', () => {
    expect(checksumOf({ version: 2, statements: V1.statements })).not.toBe(V1_CHECKSUM);
  });
});

describe('creating a database that does not exist', () => {
  it('applies v1 and reports the frozen checksum', () => {
    expect(initialise(dbPath)).toEqual({ status: 'applied', version: 1, checksum: V1_CHECKSUM });
  });

  it('leaves exactly one schema object, one row, and no temporary artifacts', () => {
    initialise(dbPath);
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    expect(db.prepare('SELECT type, name, sql FROM sqlite_master').all())
      .toEqual([{ type: 'table', name: 'schema_migrations', sql: V1_CREATE }]);
    expect(db.prepare('SELECT version, checksum FROM schema_migrations').all())
      .toEqual([{ version: 1, checksum: V1_CHECKSUM }]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    db.close();
    expect(entries()).toEqual(['orchestrator.sqlite']);
  });

  it('recognizes its own database on a second call and does not rewrite it', () => {
    initialise(dbPath);
    const before = digest(dbPath);
    expect(initialise(dbPath)).toEqual({ status: 'already_at', version: 1, checksum: V1_CHECKSUM });
    expect(digest(dbPath)).toBe(before);
    expect(entries()).toEqual(['orchestrator.sqlite']);
  });
});

describe('paths', () => {
  it('refuses a relative path', () => expectCode(() => initialise('relative.sqlite'), 'E_DB_PATH_NOT_ABSOLUTE'));

  it('refuses a missing parent directory and does not create it', () => {
    const nested = join(dir, 'absent', 'orchestrator.sqlite');
    expectCode(() => initialise(nested), 'E_DB_PARENT_MISSING');
    expect(entries()).toEqual([]);
  });

  it('refuses a directory in the target position', () => {
    mkdirSync(dbPath);
    expectCode(() => initialise(dbPath), 'E_DB_NOT_SQLITE');
  });
});

describe('refusing an existing target without touching it', () => {
  it('refuses an existing empty file and leaves it empty', () => {
    writeFileSync(dbPath, '');
    expectCode(() => initialise(dbPath), 'E_DB_EMPTY_FILE');
    expect(statSync(dbPath).size).toBe(0);
    expect(entries()).toEqual(['orchestrator.sqlite']);
  });

  it('refuses a file that is not a SQLite database and leaves its bytes alone', () => {
    writeFileSync(dbPath, 'not a database');
    const before = digest(dbPath);
    expectCode(() => initialise(dbPath), 'E_DB_NOT_SQLITE');
    expect(digest(dbPath)).toBe(before);
    expect(entries()).toEqual(['orchestrator.sqlite']);
  });

  it('refuses a target that has a rollback journal beside it, without opening it', () => {
    initialise(dbPath);
    writeFileSync(`${dbPath}-journal`, 'pretend this is a hot journal');
    const before = digest(dbPath);
    const journalBefore = digest(`${dbPath}-journal`);
    expectCode(() => initialise(dbPath), 'E_DB_RECOVERY_REQUIRED');
    expect(digest(dbPath)).toBe(before);
    expect(digest(`${dbPath}-journal`)).toBe(journalBefore);
  });

  it('refuses a target that has a write-ahead log beside it', () => {
    initialise(dbPath);
    writeFileSync(`${dbPath}-wal`, '');
    expectCode(() => initialise(dbPath), 'E_DB_RECOVERY_REQUIRED');
  });

  // The production classifier applies no name predicate at all, so this table is an
  // ordinary extra object. Under `NOT LIKE 'sqlite_%'` it was invisible, because LIKE
  // treats "_" as a single-character wildcard.
  it('does not hide a user table whose name begins with "sqlite"', () => {
    seed(dbPath, [V1_CREATE, REGISTRY_ROW, 'CREATE TABLE sqliteXevil (secret TEXT)']);
    const before = digest(dbPath);
    expectCode(() => initialise(dbPath), 'E_UNKNOWN_SCHEMA');
    expect(digest(dbPath)).toBe(before);
  });

  it('refuses a database whose only object is a table named like a SQLite internal one', () => {
    seed(dbPath, ['CREATE TABLE sqliteXstat (a TEXT)']);
    expectCode(() => initialise(dbPath), 'E_UNKNOWN_SCHEMA');
  });

  it('refuses a genuine SQLite internal object created by AUTOINCREMENT', () => {
    seed(dbPath, [V1_CREATE, REGISTRY_ROW, 'CREATE TABLE counters (id INTEGER PRIMARY KEY AUTOINCREMENT)']);
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const names = (db.prepare('SELECT name FROM sqlite_master').all() as { name: string }[]).map((r) => r.name);
    db.close();
    expect(names).toContain('sqlite_sequence');
    expectCode(() => initialise(dbPath), 'E_UNKNOWN_SCHEMA');
  });

  it.each([
    ['a view', 'CREATE VIEW extra AS SELECT 1'],
    ['an index', 'CREATE INDEX extra ON schema_migrations (checksum)'],
    ['a trigger', 'CREATE TRIGGER extra AFTER INSERT ON schema_migrations BEGIN SELECT 1; END'],
    ['a table', 'CREATE TABLE extra (a TEXT)'],
  ])('refuses a database that also holds %s', (_label, statement) => {
    seed(dbPath, [V1_CREATE, REGISTRY_ROW, statement]);
    expectCode(() => initialise(dbPath), 'E_UNKNOWN_SCHEMA');
  });
});

describe('registry shape and contents', () => {
  it.each([
    ['a CHECK constraint', 'CREATE TABLE schema_migrations (\n  version INTEGER PRIMARY KEY,\n  checksum TEXT NOT NULL CHECK (length(checksum) = 64),\n  applied_at TEXT NOT NULL\n)'],
    ['a UNIQUE constraint', 'CREATE TABLE schema_migrations (\n  version INTEGER PRIMARY KEY,\n  checksum TEXT NOT NULL UNIQUE,\n  applied_at TEXT NOT NULL\n)'],
    ['a conflict clause', 'CREATE TABLE schema_migrations (\n  version INTEGER PRIMARY KEY ON CONFLICT REPLACE,\n  checksum TEXT NOT NULL,\n  applied_at TEXT NOT NULL\n)'],
    ['different whitespace', 'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)'],
  ])('refuses a registry that carries %s', (_label, create) => {
    seed(dbPath, [create, REGISTRY_ROW]);
    expectCode(() => initialise(dbPath), 'E_UNKNOWN_SCHEMA');
  });

  it('refuses a registry with an extra column', () => {
    seed(dbPath, ['CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, note TEXT)']);
    expectCode(() => initialise(dbPath), 'E_UNKNOWN_SCHEMA');
  });

  it('refuses an empty registry', () => {
    seed(dbPath, [V1_CREATE]);
    expectCode(() => initialise(dbPath), 'E_REGISTRY_MALFORMED');
  });

  it('refuses a registry recording more than one version', () => {
    seed(dbPath, [V1_CREATE, REGISTRY_ROW, `INSERT INTO schema_migrations VALUES (2, '${V1_CHECKSUM}', 'x')`]);
    expectCode(() => initialise(dbPath), 'E_REGISTRY_MALFORMED');
  });

  it('refuses a version this runner does not know', () => {
    seed(dbPath, [V1_CREATE, `INSERT INTO schema_migrations VALUES (2, '${V1_CHECKSUM}', 'x')`]);
    expectCode(() => initialise(dbPath), 'E_UNKNOWN_VERSION');
  });

  it('refuses version 1 applied from different bytes', () => {
    seed(dbPath, [V1_CREATE, `INSERT INTO schema_migrations VALUES (1, '${'0'.repeat(64)}', 'x')`]);
    const before = digest(dbPath);
    expectCode(() => initialise(dbPath), 'E_CHECKSUM_MISMATCH');
    expect(digest(dbPath)).toBe(before);
  });
});

// These two patch the driver from the test side. Nothing in the production module accepts a
// callback, a statement or an injection parameter, so this is the only way to observe the
// production path failing, and a test that patched nothing would pass even if the production
// guard were deleted.
describe('the production write path, observed by patching the driver', () => {
  const proto = Database.prototype as unknown as {
    pragma: (source: string, options?: unknown) => unknown;
    prepare: (source: string) => unknown;
  };

  it('fails closed when foreign key enforcement cannot be confirmed, and publishes nothing', () => {
    const original = proto.pragma;
    proto.pragma = function patched(source: string, options?: unknown): unknown {
      if (source === 'foreign_keys') return 0;
      return original.call(this, source, options);
    };
    try {
      expectCode(() => initialise(dbPath), 'E_FOREIGN_KEYS_NOT_ENABLED');
    } finally {
      proto.pragma = original;
    }
    expect(entries()).toEqual([]);
  });

  it('rolls the migration back when the version row fails, and publishes nothing', () => {
    const original = proto.prepare;
    proto.prepare = function patched(source: string): unknown {
      if (source.startsWith('INSERT INTO schema_migrations')) throw new Error('injected');
      return original.call(this, source);
    };
    try {
      expectCode(() => initialise(dbPath), 'E_CREATE_FAILED');
    } finally {
      proto.prepare = original;
    }
    // No target, and no temporary database, journal or write-ahead file left behind.
    expect(entries()).toEqual([]);
  });
});
