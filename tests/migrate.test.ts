import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  initialise, InitError, canonicalBytes, checksumOf,
  CHECKSUM_ALGORITHM, V1, V1_CHECKSUM, V1_CREATE,
} from '../src/db/migrate.js';
import type { Migration } from '../src/db/migrate.js';

// Resolved here so the crash fixture can load the same driver from a bare child process.
const BETTER_SQLITE3 = createRequire(import.meta.url).resolve('better-sqlite3');

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

  it('refuses a target that has a write-ahead log beside it', () => {
    initialise(dbPath);
    writeFileSync(`${dbPath}-wal`, '');
    expectCode(() => initialise(dbPath), 'E_DB_RECOVERY_REQUIRED');
  });

  // F2. The sidecar check used to live only in the existing-target branch, so a stale
  // sidecar beside an absent database was ignored: the first run reported applied and the
  // second refused. The one promised capability — run it twice — was broken.
  it.each(['-journal', '-wal', '-shm'])('refuses an absent target with a stale %s beside it', (suffix) => {
    writeFileSync(dbPath + suffix, 'stale recovery artifact');
    expectCode(() => initialise(dbPath), 'E_DB_RECOVERY_REQUIRED');
    expect(entries()).toEqual([`orchestrator.sqlite${suffix}`]);
  });

  it('refuses a dangling sidecar symlink rather than treating it as absent', () => {
    symlinkSync(join(dir, 'gone'), `${dbPath}-journal`);
    expectCode(() => initialise(dbPath), 'E_DB_RECOVERY_REQUIRED');
    expect(existsSync(dbPath)).toBe(false);
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

describe('the path contract', () => {
  it.each([
    ['a relative path', 'relative.sqlite'],
    ['the empty string', ''],
    // A leading space is refused one check earlier: such a path is not absolute at all.
    ['a leading space', ' /tmp/db.sqlite'],
  ])('refuses %s', (_label, path) => expectCode(() => initialise(path), 'E_DB_PATH_NOT_ABSOLUTE'));

  it.each([
    ['a "." segment', (d: string) => `${d}/./db.sqlite`],
    ['a ".." segment', (d: string) => `${d}/sub/../db.sqlite`],
    ['repeated separators', (d: string) => `${d}//db.sqlite`],
    ['a trailing separator', (d: string) => `${d}/db.sqlite/`],
    ['a "." basename', (d: string) => `${d}/.`],
    ['a ".." basename', (d: string) => `${d}/..`],
    // F1. better-sqlite3 trims the filename before opening, so these spellings name one
    // file to link() and a different one to SQLite.
    ['a trailing space', (d: string) => `${d}/db.sqlite `],
    ['a trailing tab', (d: string) => `${d}/db.sqlite\t`],
  ])('refuses %s and creates nothing', (_label, build) => {
    mkdirSync(join(dir, 'sub'));
    expectCode(() => initialise(build(dir)), 'E_DB_PATH_NOT_CANONICAL');
    expect(entries()).toEqual(['sub']);
  });

  it('refuses a symlink in the target position without following it', () => {
    const real = join(dir, 'real.sqlite');
    initialise(real);
    const before = digest(real);
    symlinkSync(real, dbPath);
    expectCode(() => initialise(dbPath), 'E_DB_TARGET_NOT_REGULAR_FILE');
    expect(readlinkSync(dbPath)).toBe(real);
    expect(digest(real)).toBe(before);
  });

  it('refuses a dangling symlink instead of creating through it', () => {
    symlinkSync(join(dir, 'nothing-here'), dbPath);
    expectCode(() => initialise(dbPath), 'E_DB_TARGET_NOT_REGULAR_FILE');
    expect(existsSync(join(dir, 'nothing-here'))).toBe(false);
    expect(entries()).toEqual(['orchestrator.sqlite']);
  });

  it('refuses a symlink pointing outside the directory, leaving the victim untouched', () => {
    const outside = mkdtempSync(join(tmpdir(), 'a1-outside-'));
    const victim = join(outside, 'victim');
    writeFileSync(victim, 'unrelated bytes');
    try {
      symlinkSync(victim, dbPath);
      expectCode(() => initialise(dbPath), 'E_DB_TARGET_NOT_REGULAR_FILE');
      expect(readFileSync(victim, 'utf8')).toBe('unrelated bytes');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it.each([
    ['a directory', (p: string) => mkdirSync(p)],
    ['a FIFO', (p: string) => { execFileSync('mkfifo', [p]); }],
  ])('refuses %s in the target position', (_label, make) => {
    make(dbPath);
    expectCode(() => initialise(dbPath), 'E_DB_TARGET_NOT_REGULAR_FILE');
  });

  it('resolves a symlinked parent and works inside the real directory', () => {
    const real = join(dir, 'realdir');
    mkdirSync(real);
    symlinkSync(real, join(dir, 'linkdir'));
    expect(initialise(join(dir, 'linkdir', 'orchestrator.sqlite')).status).toBe('applied');
    expect(readdirSync(real)).toEqual(['orchestrator.sqlite']);
  });

  it('treats a symlinked parent and the real parent as one target', () => {
    const real = join(dir, 'realdir');
    mkdirSync(real);
    symlinkSync(real, join(dir, 'linkdir'));
    expect(initialise(join(dir, 'realdir', 'orchestrator.sqlite')).status).toBe('applied');
    expect(initialise(join(dir, 'linkdir', 'orchestrator.sqlite')).status).toBe('already_at');
    expect(readdirSync(real)).toEqual(['orchestrator.sqlite']);
  });

  it('refuses a missing parent and does not create it', () => {
    expectCode(() => initialise(join(dir, 'absent', 'db.sqlite')), 'E_DB_PARENT_MISSING');
    expect(entries()).toEqual([]);
  });
});

// F15. Round 7. Recovery is detected at "<target>-journal", "-wal" and "-shm", but those names
// were themselves accepted as database targets, so two ordinary db:init calls could put a healthy
// database inside another one's recovery namespace and make the first permanently unopenable.
// These cases drive the real initialise and assert the outcome of the whole sequence, because the
// pre-existing stale-sidecar tests only restate the unconditional predicate and stay green while
// the conflict exists.
describe('the sidecar filename namespace', () => {
  const SUFFIXES = ['-journal', '-wal', '-shm'];

  // Refusal must not depend on discovery order, so the conflicting name is refused here with no
  // other database on disk at all. A guard that only fired when the shorter name already existed
  // would pass the "second" cases below and still lose the guarantee when the order is reversed.
  it.each(SUFFIXES)('refuses "%s" when no other database exists', (suffix) => {
    expectCode(() => initialise(dbPath + suffix), 'E_DB_PATH_SIDECAR_RESERVED');
    expect(entries()).toEqual([]);
  });

  it.each(SUFFIXES)('refuses "%s" once the base database exists, and touches nothing', (suffix) => {
    initialise(dbPath);
    const before = digest(dbPath);
    expectCode(() => initialise(dbPath + suffix), 'E_DB_PATH_SIDECAR_RESERVED');
    expect(entries()).toEqual(['orchestrator.sqlite']);
    expect(digest(dbPath)).toBe(before);
  });

  // macOS is a supported platform and its default APFS volumes are case-insensitive, so an
  // upper-case spelling is the same directory entry as the sidecar SQLite writes.
  it.each(['-JOURNAL', '-Wal', '-sHm'])('refuses the case variant "%s"', (suffix) => {
    expectCode(() => initialise(dbPath + suffix), 'E_DB_PATH_SIDECAR_RESERVED');
  });

  it('leaves the reviewer sequence idempotent instead of demanding recovery', () => {
    expect(initialise(dbPath).status).toBe('applied');
    expectCode(() => initialise(`${dbPath}-journal`), 'E_DB_PATH_SIDECAR_RESERVED');
    // Before the fix this third call raised E_DB_RECOVERY_REQUIRED.
    expect(initialise(dbPath).status).toBe('already_at');
  });

  // The reservation must not weaken the recovery guard it protects: a genuine leftover journal,
  // written by something other than db:init, is still refused and still left on disk.
  it('keeps refusing a real leftover journal, and does not remove it', () => {
    initialise(dbPath);
    writeFileSync(`${dbPath}-journal`, 'leftover');
    expectCode(() => initialise(dbPath), 'E_DB_RECOVERY_REQUIRED');
    expect(entries()).toEqual(['orchestrator.sqlite', 'orchestrator.sqlite-journal']);
  });
});

// F16. Round 8. Reserving the sidecar suffixes with toLowerCase() was not enough: a
// case-insensitive filesystem folds more than ASCII case, so "a.sqlite-ſhm" (U+017F) passed the
// reservation and still occupied "a.sqlite-shm". The name is now restricted to an alphabet no
// supported filesystem folds together, checked on the basename exactly as given.
describe('the database name alphabet', () => {
  // U+017F folds to "s"; the others are full-width, accented, zero-width and Roman-numeral
  // spellings that a filesystem or a normalizer could map onto an ASCII name.
  const REFUSED = ['a.sqlite-ſhm', 'ｄb.sqlite', 'café.sqlite', 'db.sqlite​x', 'Ⅰ.sqlite'];

  it.each(REFUSED)('refuses "%s" and creates nothing', (name) => {
    expectCode(() => initialise(join(dir, name)), 'E_DB_PATH_NAME_UNSUPPORTED');
    expect(entries()).toEqual([]);
  });

  // The restriction is on the name this runner reasons about, not on where the caller keeps it.
  it('accepts a legal name under a non-ASCII parent, and repeats', () => {
    const parent = join(dir, '測試目錄', 'ſub');
    mkdirSync(parent, { recursive: true });
    const target = join(parent, 'orchestrator.sqlite');
    expect(initialise(target).status).toBe('applied');
    expect(initialise(target).status).toBe('already_at');
  });

  it('still accepts the ordinary alphabet', () => {
    expect(initialise(join(dir, 'orch_2026-09.v1.sqlite')).status).toBe('applied');
  });

  // Does this volume actually have the behaviour the finding depends on? Asserted, never
  // assumed: a test that silently skips on a case-sensitive filesystem would report the APFS
  // case as covered when it was not.
  const folds = (): boolean => {
    const probe = join(dir, 'probe-shm');
    writeFileSync(probe, 'x');
    try {
      const equal = lstatSync(join(dir, 'probe-ſhm')).ino === lstatSync(probe).ino;
      return equal;
    } catch {
      return false;
    } finally {
      unlinkSync(probe);
    }
  };

  it('keeps the reviewer sequence idempotent where the filesystem folds U+017F', () => {
    expect(initialise(dbPath).status).toBe('applied');
    expectCode(() => initialise(`${dbPath}-ſhm`), 'E_DB_PATH_NAME_UNSUPPORTED');
    expect(initialise(dbPath).status).toBe('already_at');
    // On a folding volume the middle call is what used to poison the namespace; on a
    // case-sensitive one it cannot, and that is recorded rather than passed off as coverage.
    if (!folds()) {
      expect(existsSync(`${dbPath}-shm`)).toBe(false);
    }
  });
});

// F6. The rollback proof runs through the real initialise. The production module exports no
// seam and takes no callback, so the observation is made from the test side by intercepting
// the driver: the INSERT is made to fail, and the connection is inspected at the moment
// production closes it — before the temporary file is deleted. A test that merely checked
// the directory afterwards passed whether or not a transaction existed, because cleanup
// removed the evidence either way.
describe('the migration transaction, observed on the production path', () => {
  const proto = Database.prototype as unknown as {
    prepare: (source: string) => unknown;
    close: () => unknown;
  };

  function initialiseWithFailingInsert(): { snapshot: string[] | undefined; observed: boolean } {
    const prepare = proto.prepare;
    const close = proto.close;
    let snapshot: string[] | undefined;
    let observed = false;
    proto.prepare = function patched(this: Database.Database, source: string): unknown {
      if (source.startsWith('INSERT INTO schema_migrations')) throw new Error('injected');
      return prepare.call(this, source);
    };
    proto.close = function patched(this: Database.Database): unknown {
      if (this.open && !observed) {
        observed = true;
        snapshot = (prepare.call(this, 'SELECT name FROM sqlite_master') as { all(): { name: string }[] })
          .all().map((r) => r.name);
      }
      return close.call(this);
    };
    try {
      expectCode(() => initialise(dbPath), 'E_CREATE_FAILED');
    } finally {
      proto.prepare = prepare;
      proto.close = close;
    }
    return { snapshot, observed };
  }

  it('rolls back on the production connection, observed before cleanup', () => {
    const { snapshot, observed } = initialiseWithFailingInsert();
    // The observation must actually have happened: an absent snapshot is a broken test, not
    // a passing one, and an empty default would hide exactly the defect being checked.
    expect(observed).toBe(true);
    expect(snapshot).toBeDefined();
    expect(snapshot).toEqual([]);
    expect(entries()).toEqual([]);
  });

  it('commits both statements together when nothing fails', () => {
    initialise(dbPath);
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      expect(db.prepare('SELECT name FROM sqlite_master').all()).toEqual([{ name: 'schema_migrations' }]);
      expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
    } finally {
      db.close();
    }
  });
});

// F8. Two separate kinds of evidence, deliberately not conflated.
describe('the classification connection is opened read-only', () => {
  it('is proved on the real initialise path, by inspecting the live connection', () => {
    initialise(dbPath);
    const prepare = Database.prototype.prepare;
    const modes: boolean[] = [];
    (Database.prototype as unknown as { prepare: (s: string) => unknown }).prepare =
      function patched(this: Database.Database, source: string): unknown {
        modes.push(this.readonly);
        return prepare.call(this, source);
      };
    try {
      expect(initialise(dbPath).status).toBe('already_at');
    } finally {
      (Database.prototype as unknown as { prepare: (s: string) => unknown }).prepare = prepare;
    }
    // Every statement the classifier ran belonged to a read-only connection.
    expect(modes.length).toBeGreaterThan(0);
    expect(modes.every((readonly) => readonly)).toBe(true);
  });

  // CHARACTERIZATION EVIDENCE, not a product-entry proof. It records what the driver does to
  // a crashed database when opened read-write. Production refuses this state earlier, at the
  // sidecar check, so no product entry point reaches this code path.
  it('characterization: a read-write open of a crashed empty database deletes its journal', () => {
    const victim = join(dir, 'characterization.sqlite');
    const crash = `const D=require(${JSON.stringify(BETTER_SQLITE3)});`
      + 'const d=new D(process.argv[1]);'
      + "d.exec('BEGIN IMMEDIATE');d.exec('CREATE TABLE half (a)');"
      + "process.kill(process.pid,'SIGKILL');";
    try {
      execFileSync(process.execPath, ['-e', crash, victim], { stdio: 'ignore' });
    } catch { /* killed on purpose */ }
    expect(existsSync(`${victim}-journal`)).toBe(true);

    const db = new Database(victim);
    db.prepare('SELECT name FROM sqlite_master').all();
    db.close();
    expect(existsSync(`${victim}-journal`)).toBe(false);
  });
});

describe('a database left mid-transaction by a killed process', () => {
  it('is refused, and its bytes and journal are left exactly as they were', () => {
    initialise(dbPath);
    const crash = `const D=require(${JSON.stringify(BETTER_SQLITE3)});`
      + 'const d=new D(process.argv[1]);'
      + "d.exec('BEGIN IMMEDIATE');d.exec('CREATE TABLE half_written (a TEXT)');"
      + "process.kill(process.pid,'SIGKILL');";
    try {
      execFileSync(process.execPath, ['-e', crash, dbPath], { stdio: 'ignore' });
    } catch { /* the child is killed on purpose */ }

    const journal = `${dbPath}-journal`;
    expect(existsSync(journal)).toBe(true);
    const dbBefore = digest(dbPath);
    const journalBefore = digest(journal);

    expectCode(() => initialise(dbPath), 'E_DB_RECOVERY_REQUIRED');

    expect(digest(dbPath)).toBe(dbBefore);
    expect(digest(journal)).toBe(journalBefore);
    expect(entries()).toEqual(['orchestrator.sqlite', 'orchestrator.sqlite-journal']);
  });
});

// F3. Two states, each individually ILLEGAL:
//   state A — exactly the v1 schema, but the recorded checksum is wrong   -> E_CHECKSUM_MISMATCH
//   state B — the correct checksum, but an extra object in the schema     -> E_UNKNOWN_SCHEMA
// Reading the schema from A and the registry from B yields the exact v1 schema plus the
// correct checksum, which is the shape the classifier accepts. That combination never
// existed in the database, so accepting it would be a wrong accept, not a stale one.
//
// The writer is a separate process with a short busy timeout. It is NOT required to commit
// while the classifier holds its read transaction — requiring that would deadlock the test.
// The assertion is only that the classifier never reports already_at.
describe('classification reads one consistent state', () => {
  const STATE_A = [V1_CREATE, `INSERT INTO schema_migrations VALUES (1, '${'0'.repeat(64)}', 'x')`];

  let writerCommitted = false;

  function flipToStateB(): void {
    const script = `const D=require(${JSON.stringify(BETTER_SQLITE3)});`
      + 'const d=new D(process.argv[1]);d.pragma("busy_timeout = 250");'
      + 'try{d.exec("BEGIN IMMEDIATE");'
      + `d.exec("CREATE TABLE extra (a TEXT)");`
      + `d.exec("UPDATE schema_migrations SET checksum = '${V1_CHECKSUM}'");`
      + 'd.exec("COMMIT");process.stdout.write("committed");}'
      + 'catch(e){process.stdout.write("blocked");}d.close();';
    // The writer reports whether it actually committed instead of swallowing the outcome.
    // It is not required to win: while the classifier holds its read transaction it cannot,
    // and demanding that it should would deadlock this test.
    try {
      const result = execFileSync(process.execPath, ['-e', script, dbPath], { encoding: 'utf8' });
      writerCommitted = result.includes('committed');
    } catch {
      writerCommitted = false;
    }
  }

  it('refuses each state on its own', () => {
    seed(dbPath, STATE_A);
    expectCode(() => initialise(dbPath), 'E_CHECKSUM_MISMATCH');
    rmSync(dbPath);
    seed(dbPath, [V1_CREATE, REGISTRY_ROW, 'CREATE TABLE extra (a TEXT)']);
    expectCode(() => initialise(dbPath), 'E_UNKNOWN_SCHEMA');
  });

  it('never combines one state’s schema with another state’s registry row', () => {
    seed(dbPath, STATE_A);
    // The writer commits between what would be two separate reads. Inside one read
    // transaction it cannot, so the classifier sees only state A.
    const prepare = Database.prototype.prepare;
    let flipped = false;
    let insideTransaction = false;
    (Database.prototype as unknown as { prepare: (s: string) => unknown }).prepare =
      function patched(this: Database.Database, source: string): unknown {
        // Flip between the two reads: the schema read has completed, the registry read has
        // not started. Firing before the first read would simply show both reads state B.
        if (!flipped && source.includes('FROM schema_migrations')) {
          flipped = true;
          // A read transaction must be open at this point; without one the two reads are
          // not a snapshot at all.
          insideTransaction = this.inTransaction;
          flipToStateB();
        }
        return prepare.call(this, source);
      };
    let outcome: string;
    try {
      try {
        outcome = initialise(dbPath).status;
      } catch (error) {
        // The exact error is asserted below. Anything else — including an incidental
        // "cannot commit - no transaction is active" from a half-removed guard — is
        // recorded verbatim so it cannot be mistaken for the expected refusal.
        outcome = error instanceof InitError ? error.code : `NOT_AN_INIT_ERROR:${String(error)}`;
      }
    } finally {
      (Database.prototype as unknown as { prepare: (s: string) => unknown }).prepare = prepare;
    }
    expect(flipped).toBe(true);
    expect(insideTransaction).toBe(true);
    expect(writerCommitted).toBe(false);
    // State A, read whole: the schema is exactly v1 and the checksum is wrong. Asserting the
    // precise code, not merely "not already_at", is what makes this a snapshot proof.
    expect(outcome).toBe('E_CHECKSUM_MISMATCH');
  });
});

// F9. A database another process is holding is valid, not malformed.
describe('lock contention', () => {
  it('reports a retryable code instead of calling the database invalid', async () => {
    initialise(dbPath);
    const holder = `const D=require(${JSON.stringify(BETTER_SQLITE3)});`
      + 'const d=new D(process.argv[1]);d.exec("BEGIN EXCLUSIVE");'
      // Held well past the driver's five-second busy timeout, so the classifier really does
      // give up rather than simply outwaiting the holder.
      + 'process.stdout.write("held\\n");setTimeout(()=>{},20000);';
    const child = spawn(process.execPath, ['-e', holder, dbPath], { stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      await new Promise<void>((resolveHeld, rejectHeld) => {
        child.stdout.on('data', () => resolveHeld());
        child.on('exit', () => rejectHeld(new Error('the lock holder exited early')));
      });
      expectCode(() => initialise(dbPath), 'E_DB_BUSY');
    } finally {
      child.kill('SIGKILL');
    }
  });
});

// F10. Real power-loss durability is not testable here and is not claimed. What is testable,
// and is tested, is that the synchronisation happens at all, on the right targets, in the
// right order, and that a failure to synchronise is reported instead of swallowed.
describe('the synchronisation steps that precede a success report', () => {
  afterEach(() => { vi.doUnmock('node:fs'); vi.resetModules(); });

  async function importWithFsync(onSync: (path: string) => void): Promise<typeof import('../src/db/migrate.js')> {
    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      const paths = new Map<number, string>();
      return {
        ...actual,
        openSync(target: string, flags: string) {
          const fd = actual.openSync(target, flags);
          paths.set(fd, target);
          return fd;
        },
        fsyncSync(fd: number) {
          onSync(paths.get(fd) ?? 'unknown');
          return actual.fsyncSync(fd);
        },
      };
    });
    return import('../src/db/migrate.js');
  }

  it('flushes the new database and then its parent directory', async () => {
    const synced: string[] = [];
    const { initialise: fresh } = await importWithFsync((target) => synced.push(target));
    expect(fresh(dbPath).status).toBe('applied');

    expect(synced).toHaveLength(2);
    // The file's own contents first, while it is still unpublished under a temporary name…
    expect(synced[0]).toMatch(/\/\.dev-orch-init-[^/]+\.tmp$/);
    // …then the directory entry that makes the published name durable. Compared against the
    // resolved parent, because that is the form production uses everywhere downstream.
    expect(synced[1]).toBe(realpathSync(dir));
  });

  it('reports a failure, not applied, when flushing the database fails', async () => {
    const { initialise: fresh, InitError: FreshError } = await importWithFsync((target) => {
      if (target.endsWith('.tmp')) throw new Error('injected sync failure');
    });
    let code: string | undefined;
    try {
      fresh(dbPath);
    } catch (error) {
      code = error instanceof FreshError ? error.code : 'WRONG_TYPE';
    }
    expect(code).toBe('E_CREATE_FAILED');
    // Nothing was published, and the temporary file did not survive.
    expect(entries()).toEqual([]);
  });

});

// F2, fault-injection evidence. A sidecar whose lstat fails for a reason other than ENOENT
// must refuse the target, not be read as "absent". Real OS permission reproduction is
// NOT_RUN; the error is injected instead, only for the one sidecar path, with every other
// filesystem call left untouched.
describe('a sidecar that cannot be stat-ed', () => {
  afterEach(() => { vi.doUnmock('node:fs'); vi.resetModules(); });

  it('refuses the target instead of treating the sidecar as absent', async () => {
    const journal = `${realpathSync(dir)}/orchestrator.sqlite-journal`;
    let injected = 0;
    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        lstatSync(target: string, options?: unknown) {
          if (target === journal) {
            injected += 1;
            const denied = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
            denied.code = 'EACCES';
            throw denied;
          }
          return (actual.lstatSync as (t: string, o?: unknown) => unknown)(target, options);
        },
      };
    });
    const { initialise: fresh, InitError: FreshError } = await import('../src/db/migrate.js');

    let code: string | undefined;
    try {
      fresh(dbPath);
    } catch (error) {
      code = error instanceof FreshError ? error.code : `WRONG_TYPE:${String(error)}`;
    }

    // The injection must actually have fired; a miss would make this test pass for the
    // wrong reason, and an unrelated exception must not be mistaken for the refusal.
    expect(injected).toBeGreaterThan(0);
    expect(code).toBe('E_DB_RECOVERY_REQUIRED');
    expect(existsSync(dbPath)).toBe(false);
    expect(entries()).toEqual([]);
  });
});

// 1. A cleanly closed write-ahead-log database leaves no sidecar behind, so the sidecar check
// cannot see it, and merely opening it read-only makes SQLite create -wal and -shm. The
// journal format is settled from the file header before any connection exists.
describe('a database in the write-ahead-log format', () => {
  function seedWal(target: string): void {
    const db = new Database(target);
    db.pragma('journal_mode = WAL');
    db.exec(V1_CREATE);
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)')
      .run(1, V1_CHECKSUM, '2026-01-01T00:00:00.000Z');
    db.close();
  }

  it('is refused twice, without creating sidecars or changing a byte', () => {
    seedWal(dbPath);
    // The premise: cleanly closed, exact v1 content, and no sidecar for the earlier check
    // to catch. Only the header distinguishes it.
    expect(entries()).toEqual(['orchestrator.sqlite']);
    const before = digest(dbPath);

    expectCode(() => initialise(dbPath), 'E_DB_UNSUPPORTED_FORMAT');
    expect(entries()).toEqual(['orchestrator.sqlite']);
    expect(digest(dbPath)).toBe(before);

    // Twice: the first call must not have left the target in a state the second refuses
    // differently.
    expectCode(() => initialise(dbPath), 'E_DB_UNSUPPORTED_FORMAT');
    expect(entries()).toEqual(['orchestrator.sqlite']);
    expect(digest(dbPath)).toBe(before);
  });

  it('refuses a file whose header is not SQLite at all', () => {
    writeFileSync(dbPath, 'x'.repeat(200));
    expectCode(() => initialise(dbPath), 'E_DB_NOT_SQLITE');
  });

  it('still accepts, and then recognizes, an ordinary rollback-journal database', () => {
    expect(initialise(dbPath).status).toBe('applied');
    expect(initialise(dbPath).status).toBe('already_at');
    expect(entries()).toEqual(['orchestrator.sqlite']);
  });
});

// 2. Publication that succeeds and then fails to flush is a different event from a failure
// before publication, and is reported as one.
describe('a failure to flush after the database is published', () => {
  afterEach(() => { vi.doUnmock('node:fs'); vi.resetModules(); });

  it('reports a distinct code and leaves the published database in place', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      const paths = new Map<number, string>();
      return {
        ...actual,
        openSync(target: string, flags: string) {
          const fd = actual.openSync(target, flags);
          paths.set(fd, target);
          return fd;
        },
        fsyncSync(fd: number) {
          if (paths.get(fd) === realpathSync(dir)) throw new Error('injected directory sync failure');
          return actual.fsyncSync(fd);
        },
      };
    });
    const { initialise: fresh, InitError: FreshError } = await import('../src/db/migrate.js');

    let code: string | undefined;
    try {
      fresh(dbPath);
    } catch (error) {
      code = error instanceof FreshError ? error.code : `WRONG_TYPE:${String(error)}`;
    }
    expect(code).toBe('E_PUBLISHED_NOT_SYNCED');

    // The target exists, is a complete v1 database, and was NOT deleted to fake a rollback.
    expect(entries()).toEqual(['orchestrator.sqlite']);
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    expect(db.prepare('SELECT version, checksum FROM schema_migrations').all())
      .toEqual([{ version: 1, checksum: V1_CHECKSUM }]);
    db.close();

    // A later run recognizes the version. That is all it proves: it says nothing about
    // whether the earlier flush ever reached the disk.
    vi.doUnmock('node:fs');
    vi.resetModules();
    const { initialise: again } = await import('../src/db/migrate.js');
    expect(again(dbPath).status).toBe('already_at');
  });
});

// 4. An unpaired surrogate is refused rather than silently replaced, because UTF-8 encoding
// would map it to U+FFFD and let two different declared migrations share one preimage.
describe('checksum input domain', () => {
  it('refuses an ill-formed statement instead of rewriting it', () => {
    expectCode(() => checksumOf({ version: 1, statements: ['\uD800'] }), 'E_INTERNAL');
    expectCode(() => canonicalBytes({ version: 1, statements: ['a\uDC00b'] }), 'E_INTERNAL');
  });

  it('accepts the legitimate replacement character, which is a real code point', () => {
    const sum = checksumOf({ version: 1, statements: ['�'] });
    expect(sum).toMatch(/^[0-9a-f]{64}$/);
    // The pair that used to collide can no longer be compared: one side is now refused.
    expect(sum).not.toBe(V1_CHECKSUM);
  });

  it('leaves the released v1 identity untouched', () => {
    expect(checksumOf(V1)).toBe(V1_CHECKSUM);
  });

  // F17. Round 9. Validation and encoding read the caller's values separately, so an accessor
  // could answer the checks with a legal value and the preimage with another. "Did it throw" is
  // not a usable oracle here, and neither is a digest comparison against the ill-formed case:
  // a lone surrogate and U+FFFD encode to the same bytes, so that shape cannot say WHICH value
  // was encoded. These cases therefore make the late value one whose encoding differs, so the
  // resulting digest names the value that actually reached the preimage.
  describe('a value that changes between validation and encoding', () => {
    const EARLY = "SELECT 'early'";
    const LATE = "SELECT 'late'";

    /** An array whose element 0 returns something else after its first read. */
    const shifting = (first: string, rest: string): string[] => {
      let reads = 0;
      const a = [first];
      Object.defineProperty(a, '0', {
        enumerable: true,
        configurable: true,
        get: () => (reads++ === 0 ? first : rest),
      });
      return a;
    };

    it('encodes the statement it validated, not a later one', () => {
      const shifted = checksumOf({ version: 1, statements: shifting(EARLY, LATE) });
      expect(shifted).toBe(checksumOf({ version: 1, statements: [EARLY] }));
      expect(shifted).not.toBe(checksumOf({ version: 1, statements: [LATE] }));
    });

    it('encodes the statement it validated when the array is a Proxy', () => {
      let reads = 0;
      const statements = new Proxy([EARLY], {
        get: (target, prop, receiver) => (prop === '0'
          ? (reads++ === 0 ? EARLY : LATE)
          : Reflect.get(target, prop, receiver)),
      });
      expect(checksumOf({ version: 1, statements })).toBe(
        checksumOf({ version: 1, statements: [EARLY] }),
      );
    });

    it('encodes the version it validated, not a later one', () => {
      let reads = 0;
      const migration = { statements: [EARLY] } as { statements: string[]; version: number };
      Object.defineProperty(migration, 'version', {
        enumerable: true,
        get: () => (reads++ < 3 ? 1 : 2),
      });
      expect(checksumOf(migration)).toBe(checksumOf({ version: 1, statements: [EARLY] }));
      expect(checksumOf(migration)).not.toBe(checksumOf({ version: 2, statements: [EARLY] }));
    });

    // The security-relevant shape. The digest is ambiguous by construction, so the assertion is
    // that the ill-formed value cannot be what was encoded: either the call is refused, or the
    // validated value is what came out.
    it('never lets an ill-formed statement reach the preimage after validation', () => {
      const statements = shifting('x�', 'x\uD800');
      let digest: string | undefined;
      try {
        digest = checksumOf({ version: 1, statements });
      } catch (error) {
        expect(error).toBeInstanceOf(InitError);
        expect((error as InitError).code).toBe('E_INTERNAL');
        return;
      }
      expect(digest).toBe(checksumOf({ version: 1, statements: ['x�'] }));
    });

    it('still refuses a statement that is ill-formed from the start', () => {
      expectCode(() => checksumOf({ version: 1, statements: ['a\uD800'] }), 'E_INTERNAL');
    });

    // The capture must not quietly widen what `statements` may be. Anything iterable or
    // array-like would otherwise be reinterpreted: a string became one statement per character,
    // and a bare number encoded as zero statements.
    it.each([
      ['a string', "SELECT 'a'"],
      ['a plain array-like object', { 0: "SELECT 'a'", length: 1 }],
      ['a Set', new Set(["SELECT 'a'"])],
      ['a generator object', (function* () { yield "SELECT 'a'"; })()],
      ['a number', 3],
      ['null', null],
    ])('refuses %s in place of the statements array', (_label, statements) => {
      expectCode(
        () => canonicalBytes({ version: 1, statements } as unknown as Migration),
        'E_INTERNAL',
      );
    });

    // Symbol.iterator is caller-controlled, so a capture that goes through it does not capture
    // what the array holds. Compared over canonical bytes, not a digest: the bytes name the
    // statement that was encoded, where a digest only says two inputs agreed.
    it('captures what the array holds, not what its iterator yields', () => {
      const statements = [EARLY];
      Object.defineProperty(statements, Symbol.iterator, {
        configurable: true,
        value: function* () { yield LATE; },
      });
      expect(canonicalBytes({ version: 1, statements })).toEqual(
        canonicalBytes({ version: 1, statements: [EARLY] }),
      );
    });

    it('encodes the validated statement, compared over canonical bytes', () => {
      expect(canonicalBytes({ version: 1, statements: shifting(EARLY, LATE) })).toEqual(
        canonicalBytes({ version: 1, statements: [EARLY] }),
      );
    });

    // F19. Round 10. Reading a caller's value runs caller code, and that code can replace the
    // built-ins the encoder uses next. `.push` is resolved before its argument is evaluated, so
    // a getter that reassigned Array.prototype.push let the first push through and silently
    // dropped the rest: ['A','B'] and ['C'] both emitted a bare "statements:1" header and became
    // the same preimage. Varying returned values or Symbol.iterator does not reach this — the
    // mutation has to be of the prototype production itself dispatches through.
    describe('caller code that sabotages the built-ins the encoder uses', () => {
      /** Restores whatever this test replaced, whether or not the assertion passed. */
      const withRestored = <T>(restore: () => void, body: () => T): T => {
        try {
          return body();
        } finally {
          restore();
        }
      };

      const sabotagingPush = (values: string[]): string[] => {
        const a = values.slice();
        Object.defineProperty(a, '0', {
          enumerable: true,
          configurable: true,
          get() {
            Array.prototype.push = function push(this: unknown[]) { return this.length; };
            return values[0];
          },
        });
        return a;
      };

      it('keeps distinct migrations distinct when a getter replaces Array.prototype.push', () => {
        const realPush = Array.prototype.push;
        const [ab, c] = withRestored(() => { Array.prototype.push = realPush; }, () => [
          canonicalBytes({ version: 1, statements: sabotagingPush(['A', 'B']) }),
          canonicalBytes({ version: 1, statements: sabotagingPush(['C']) }),
        ]);
        expect(ab).not.toEqual(c);
        // Stronger than "not equal": sabotage must make no difference at all.
        expect(ab).toEqual(canonicalBytes({ version: 1, statements: ['A', 'B'] }));
        expect(c).toEqual(canonicalBytes({ version: 1, statements: ['C'] }));
      });

      // String iteration dispatches through String.prototype[Symbol.iterator], so replacing it
      // could let an ill-formed statement pass validation while Buffer.from encodes the real
      // content. Validation now walks the string by index instead.
      // F20. Round 11. Capturing the method is not enough: `charCodeAt.call(...)` still looked
      // `call` up on the function object, inherited from Function.prototype and equally
      // replaceable. Faking it made every character report as 'A', so a lone surrogate passed
      // validation and was encoded as U+FFFD — the collision this whole rule exists to prevent.
      it('still refuses an ill-formed statement when Function.prototype.call is replaced', () => {
        const realCall = Function.prototype.call;
        const lying = function (this: unknown, thisArg: unknown, ...args: unknown[]) {
          if (typeof thisArg === 'string') return 0x41;   // never a surrogate
          return Reflect.apply(this as (...a: unknown[]) => unknown, thisArg, args);
        };
        const statements = ['a', 'b\uD800'];
        Object.defineProperty(statements, '0', {
          enumerable: true,
          configurable: true,
          get() {
            Object.defineProperty(Function.prototype, 'call', {
              configurable: true, writable: true, value: lying,
            });
            return 'a';
          },
        });
        withRestored(
          () => Object.defineProperty(Function.prototype, 'call', {
            configurable: true, writable: true, value: realCall,
          }),
          () => expectCode(() => canonicalBytes({ version: 1, statements }), 'E_INTERNAL'),
        );
      });

      // The same class one level further out: `length` on a Buffer is a getter inherited from
      // %TypedArray%.prototype. Faking it made the old shape write the wrong `len:` prefix, so
      // the length prefixing that guarantees injectivity no longer held. The preimage is now
      // assembled as a primitive string, using the captured Buffer.byteLength.
      it('encodes the same bytes when the TypedArray length getter is replaced', () => {
        const proto = Object.getPrototypeOf(Uint8Array.prototype) as object;
        const real = Object.getOwnPropertyDescriptor(proto, 'length')!;
        const statements = ['AB'];
        Object.defineProperty(statements, '0', {
          enumerable: true,
          configurable: true,
          get() {
            Object.defineProperty(proto, 'length', { configurable: true, get: () => 1 });
            return 'AB';
          },
        });
        // Restore before comparing: reading the result under a poisoned getter would measure
        // Buffer.prototype.toString rather than what the encoder produced.
        const sabotaged = withRestored(
          () => Object.defineProperty(proto, 'length', real),
          () => canonicalBytes({ version: 1, statements }),
        );
        expect(sabotaged).toEqual(canonicalBytes({ version: 1, statements: ['AB'] }));
      });

      it('still refuses an ill-formed statement when String iteration is replaced', () => {
        const real = Object.getOwnPropertyDescriptor(String.prototype, Symbol.iterator)!;
        const statements = ['a\uD800'];
        Object.defineProperty(statements, '0', {
          enumerable: true,
          configurable: true,
          get() {
            Object.defineProperty(String.prototype, Symbol.iterator, {
              configurable: true,
              writable: true,
              value: function* claimsHarmless() { yield 'x'; },
            });
            return 'a\uD800';
          },
        });
        withRestored(
          () => Object.defineProperty(String.prototype, Symbol.iterator, real),
          () => expectCode(() => canonicalBytes({ version: 1, statements }), 'E_INTERNAL'),
        );
      });
    });
  });
});

// 5. The declared platform boundary is enforced before anything touches the target.
describe('the supported platform boundary', () => {
  it('agrees across package.json, the lockfile root and the runtime', async () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as
      { os: string[]; engines: { node: string } };
    const lock = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package-lock.json'), 'utf8')) as
      { packages: Record<string, { os?: string[]; engines?: { node: string } }> };
    const root = lock.packages[''];
    expect(manifest.os).toEqual(['linux', 'darwin']);
    expect(root?.os).toEqual(manifest.os);
    expect(root?.engines?.node).toBe(manifest.engines.node);
    // The platform this suite runs on is one of the declared ones.
    expect(manifest.os).toContain(process.platform);
  });
});

// The platform gate is only observable by pretending to be an unsupported platform: the
// suite itself runs on a supported one, so without this the guard could be deleted unnoticed.
describe('an unsupported platform', () => {
  it('is refused before anything touches the target', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      expectCode(() => initialise(dbPath), 'E_PLATFORM_UNSUPPORTED');
    } finally {
      if (original) Object.defineProperty(process, 'platform', original);
    }
    expect(process.platform).not.toBe('win32');
    // No database, no temporary file, nothing.
    expect(entries()).toEqual([]);
  });
});

// Four facts are recorded separately — published, identity confirmed, synced, temporary
// removed — and one exit reads them. None may stand for another, cleanup may never overwrite
// a primary error, and a cleanup failure on an otherwise successful run may not pass as
// success. A published target is never deleted to simulate a rollback.
describe('what this run actually did', () => {
  afterEach(() => { vi.doUnmock('node:fs'); vi.resetModules(); });

  interface Injection {
    failLstatAfterLink?: boolean;
    breakIdentity?: boolean;
    failDirectorySync?: boolean;
    failCleanup?: boolean;
    publishWinnerBeforeLink?: string;
    linkUnsupported?: boolean;
  }

  async function initialiseWith(injection: Injection): Promise<string> {
    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      const paths = new Map<number, string>();
      let linked = false;
      return {
        ...actual,
        linkSync(from: string, to: string) {
          // FAULT INJECTION, not a real filesystem. A filesystem without hard links reports
          // EPERM here; no such filesystem is mounted in this suite, so the errno is simulated.
          // What is being tested is this runner's response to that errno, not the claim that
          // exFAT behaves this way.
          if (injection.linkUnsupported) {
            const error: NodeJS.ErrnoException = new Error('operation not permitted, link');
            error.code = 'EPERM';
            error.errno = -1;
            throw error;
          }
          // The controlled interleaving: a legitimate competitor publishes first, then the
          // real linkSync runs and produces a real EEXIST — the error is not faked.
          if (injection.publishWinnerBeforeLink && !linked) {
            actual.copyFileSync(injection.publishWinnerBeforeLink, to);
          }
          linked = true;
          return actual.linkSync(from, to);
        },
        lstatSync(target: string, options?: unknown) {
          if (injection.failLstatAfterLink && linked && target === join(realpathSync(dir), 'orchestrator.sqlite')) {
            throw new Error('injected post-link lstat failure');
          }
          const stat = (actual.lstatSync as (t: string, o?: unknown) => { ino: number })(target, options);
          if (injection.breakIdentity && linked && target === join(realpathSync(dir), 'orchestrator.sqlite')) {
            return { ...stat, isFile: () => true, ino: stat.ino + 1 };
          }
          return stat;
        },
        openSync(target: string, flags: string) {
          const fd = actual.openSync(target, flags);
          paths.set(fd, target);
          return fd;
        },
        fsyncSync(fd: number) {
          if (injection.failDirectorySync && paths.get(fd) === realpathSync(dir)) {
            throw new Error('injected directory sync failure');
          }
          return actual.fsyncSync(fd);
        },
        rmSync(target: string, options?: unknown) {
          if (injection.failCleanup && target.includes('.dev-orch-init-')) {
            throw new Error('injected cleanup failure');
          }
          return (actual.rmSync as (t: string, o?: unknown) => void)(target, options);
        },
      };
    });
    const { initialise: fresh, InitError: FreshError } = await import('../src/db/migrate.js');
    try {
      return fresh(dbPath).status;
    } catch (error) {
      return error instanceof FreshError ? error.code : `NOT_AN_INIT_ERROR:${String(error)}`;
    }
  }

  // F18. Round 9. A filesystem that cannot make hard links — exFAT and FAT32 both mount locally
  // on the supported platforms — fails publication permanently, not transiently. The point of
  // this case is that the failure is reported as a failure and leaves nothing behind, so the
  // condition is at least honest even though the code cannot yet name it; the README states the
  // required capabilities and says plainly that retrying does not help.
  it('fails, publishes nothing and cleans up when the filesystem has no hard links', async () => {
    expect(await initialiseWith({ linkUnsupported: true })).toBe('E_CREATE_FAILED');
    expect(entries()).toEqual([]);
  });

  it('reports an unconfirmed identity when the post-link lstat fails, and keeps the target', async () => {
    expect(await initialiseWith({ failLstatAfterLink: true })).toBe('E_PUBLISHED_IDENTITY_UNCONFIRMED');
    expect(entries()).toEqual(['orchestrator.sqlite']);
  });

  it('reports an unconfirmed identity when the published inode is not the verified one', async () => {
    expect(await initialiseWith({ breakIdentity: true })).toBe('E_PUBLISHED_IDENTITY_UNCONFIRMED');
    expect(entries()).toEqual(['orchestrator.sqlite']);
  });

  it('reports an unconfirmed sync when the directory flush fails, and keeps the target', async () => {
    expect(await initialiseWith({ failDirectorySync: true })).toBe('E_PUBLISHED_NOT_SYNCED');
    expect(entries()).toEqual(['orchestrator.sqlite']);
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
    db.close();
  });

  it('does not pass off a cleanup failure as success on an otherwise complete run', async () => {
    expect(await initialiseWith({ failCleanup: true })).toBe('E_TEMPORARY_NOT_REMOVED');
    // The database really was published; only this run's temporary file survived.
    expect(entries()).toContain('orchestrator.sqlite');
    expect(entries().some((name) => name.startsWith('.dev-orch-init-'))).toBe(true);
  });

  it('keeps the primary error when cleanup also fails', async () => {
    // Sync failed *and* cleanup failed: the published-state error wins, and the run is not
    // reported as merely "temporary not removed".
    expect(await initialiseWith({ failDirectorySync: true, failCleanup: true }))
      .toBe('E_PUBLISHED_NOT_SYNCED');
    expect(entries()).toContain('orchestrator.sqlite');
  });
});

// The race proof, at the production entry point, with real file operations. The entry sees
// an absent target, this run builds its own temporary database, and only then does a
// legitimate competitor publish — so the EEXIST is real, not simulated.
//
// This is evidence for a controlled interleaving, not for every possible multi-process
// schedule. The parallel smoke in race.test.ts covers realistic concurrency separately.
describe('losing a publication race', () => {
  afterEach(() => { vi.doUnmock('node:fs'); vi.resetModules(); });

  async function raceAgainstWinner(failCleanup: boolean): Promise<{ result: string; hits: number }> {
    // A real v1 database, built by production, staged outside the target directory.
    const staging = mkdtempSync(join(tmpdir(), 'a1-winner-'));
    const winner = join(staging, 'winner.sqlite');
    initialise(winner);
    let hits = 0;
    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      let linked = false;
      return {
        ...actual,
        linkSync(from: string, to: string) {
          if (!linked) {
            hits += 1;
            actual.copyFileSync(winner, to);
          }
          linked = true;
          return actual.linkSync(from, to);
        },
        rmSync(target: string, options?: unknown) {
          if (failCleanup && target.includes('.dev-orch-init-')) throw new Error('injected cleanup failure');
          return (actual.rmSync as (t: string, o?: unknown) => void)(target, options);
        },
      };
    });
    const { initialise: fresh, InitError: FreshError } = await import('../src/db/migrate.js');
    let result: string;
    try {
      result = fresh(dbPath).status;
    } catch (error) {
      result = error instanceof FreshError ? error.code : `NOT_AN_INIT_ERROR:${String(error)}`;
    }
    const winnerDigest = digest(winner);
    rmSync(staging, { recursive: true, force: true });
    expect(digest(dbPath)).toBe(winnerDigest);
    return { result, hits };
  }

  it('recognizes the winner, leaves its bytes alone, and cleans up after itself', async () => {
    const { result, hits } = await raceAgainstWinner(false);
    // The control point fired and a real EEXIST followed.
    expect(hits).toBe(1);
    expect(result).toBe('already_at');
    expect(entries()).toEqual(['orchestrator.sqlite']);
  });

  it('does not silently report already_at when its own cleanup fails', async () => {
    const { result, hits } = await raceAgainstWinner(true);
    expect(hits).toBe(1);
    // Not already_at, and the code says nothing about this run having published or synced.
    expect(result).toBe('E_TEMPORARY_NOT_REMOVED');
    expect(entries()).toContain('orchestrator.sqlite');
    expect(entries().some((name) => name.startsWith('.dev-orch-init-'))).toBe(true);
  });
});

describe('the checksum version domain', () => {
  it.each([
    ['zero', 0],
    ['negative zero', -0],
    ['a negative version', -1],
    ['a fractional version', 1.5],
    ['a string that looks like a version', '1'],
  ])('refuses %s', (_label, version) => {
    expectCode(() => checksumOf({ version: version as number, statements: ['X'] }), 'E_INTERNAL');
  });

  it('leaves the released v1 identity untouched', () => {
    expect(checksumOf(V1)).toBe(V1_CHECKSUM);
    expect(V1_CHECKSUM).toBe('f2e2aa4ad993a7b4562db35e1e1196dd4843470440e36b942dc87843ef6782c8');
  });
});

describe('the declared install boundary', () => {
  it('states the same platform and cpu in the manifest and the lockfile root', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as
      { os: string[]; cpu: string[] };
    const lock = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package-lock.json'), 'utf8')) as
      { packages: Record<string, { os?: string[]; cpu?: string[] }> };
    expect(manifest.cpu).toEqual(['x64', 'arm64']);
    expect(lock.packages['']?.os).toEqual(manifest.os);
    expect(lock.packages['']?.cpu).toEqual(manifest.cpu);
  });
});

// Recovery is detected from a sidecar named after the path that was given, and SQLite derives
// the journal name the same way. A database reachable under two names can therefore have a hot
// journal beside the *other* name. This needs no attacker and no path substitution, so it is
// not covered by the accepted TOCTOU limitation.
describe('a target reachable under more than one name', () => {
  /** Dirties pages inside the existing v1 table only, so the schema stays recognizable and
   *  the refusal cannot come from E_UNKNOWN_SCHEMA instead. */
  function crashAWriteThrough(target: string): void {
    const crash = `const D=require(${JSON.stringify(BETTER_SQLITE3)});`
      + 'const d=new D(process.argv[1]);d.exec("BEGIN IMMEDIATE");'
      + 'const st=d.prepare("UPDATE schema_migrations SET applied_at = ?");'
      + 'for(let i=0;i<5000;i++) st.run("crashing-".repeat(20)+i);'
      + "process.kill(process.pid,'SIGKILL');";
    try {
      execFileSync(process.execPath, ['-e', crash, target], { stdio: 'ignore' });
    } catch { /* killed on purpose */ }
  }

  it('refuses an alias whose hot journal sits beside the other name', () => {
    const alias = join(dir, 'alias.sqlite');
    initialise(dbPath);
    linkSync(dbPath, alias);
    crashAWriteThrough(dbPath);

    // The premise: the journal exists under one name only, and the alias looks clean.
    expect(existsSync(`${dbPath}-journal`)).toBe(true);
    expect(existsSync(`${alias}-journal`)).toBe(false);
    expect(statSync(alias).nlink).toBe(2);
    const before = digest(alias);

    // The alias used to report already_at with recovery still pending on the same inode.
    expectCode(() => initialise(alias), 'E_DB_TARGET_ALIASED');
    // The original is still refused for its own reason.
    expectCode(() => initialise(dbPath), 'E_DB_RECOVERY_REQUIRED');
    // Nothing of anyone else's was removed to make either check pass.
    expect(digest(alias)).toBe(before);
    expect(existsSync(`${dbPath}-journal`)).toBe(true);
  });

  it('refuses a permanently aliased target even with no journal anywhere', () => {
    const alias = join(dir, 'alias.sqlite');
    initialise(dbPath);
    linkSync(dbPath, alias);
    const started = Date.now();
    expectCode(() => initialise(alias), 'E_DB_TARGET_ALIASED');
    // It waited rather than refusing instantly, and it stopped rather than waiting forever.
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_000);
    expect(existsSync(alias)).toBe(true);
    expect(existsSync(dbPath)).toBe(true);
  });

  it('accepts a target whose second name goes away while it waits', async () => {
    initialise(dbPath);
    const held = join(dir, 'held.sqlite');
    linkSync(dbPath, held);
    expect(statSync(dbPath).nlink).toBe(2);
    // The release must come from another process: the wait is synchronous, so a timer on
    // this thread could never run while initialise is blocked — exactly as a publishing
    // winner in its own process removes its temporary file.
    const releaser = spawn(process.execPath, ['-e',
      'setTimeout(()=>require("fs").unlinkSync(process.argv[1]),250)', held], { stdio: 'ignore' });
    try {
      expect(initialise(dbPath).status).toBe('already_at');
    } finally {
      releaser.kill('SIGKILL');
    }
    expect(existsSync(held)).toBe(false);
    expect(statSync(dbPath).nlink).toBe(1);
  });

  it('publishes normally, leaving one name behind', () => {
    // The ordinary path transiently holds two names — target and temporary — and must not be
    // penalised for it once cleanup is done.
    expect(initialise(dbPath).status).toBe('applied');
    expect(statSync(dbPath).nlink).toBe(1);
    expect(initialise(dbPath).status).toBe('already_at');
    expect(entries()).toEqual(['orchestrator.sqlite']);
  });
});

// B3. The link count is checked twice: once by the bounded wait, and once again on the fresh
// lstat that classification itself performs. The second check exists because a name can
// appear between them. An earlier revision of this pull request claimed no test could make it
// fire; that was wrong. The control point below makes it fire deterministically.
describe('a second name that appears after the wait has finished', () => {
  afterEach(() => { vi.doUnmock('node:fs'); vi.resetModules(); });

  it('is caught by the check that runs after the wait', async () => {
    initialise(dbPath);
    const target = join(realpathSync(dir), 'orchestrator.sqlite');
    const alias = join(realpathSync(dir), 'appeared-after-the-wait.sqlite');
    let sawTarget = 0;
    let linkedAfterWait = false;

    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        lstatSync(path: string, options?: unknown) {
          const stat = (actual.lstatSync as (p: string, o?: unknown) => { nlink: number })(path, options);
          if (path !== target) return stat;
          sawTarget += 1;
          // Call 1 is the occupancy probe in initialise; call 2 is the last iteration of the
          // wait, which is about to return because the count is one. The extra name is
          // created after that value has been read, so the wait still returns normally and
          // only the fresh lstat inside classification can notice.
          if (sawTarget === 2 && stat.nlink === 1) {
            actual.linkSync(target, alias);
            linkedAfterWait = true;
          }
          return stat;
        },
      };
    });
    const { initialise: fresh, InitError: FreshError } = await import('../src/db/migrate.js');

    let code: string | undefined;
    try {
      fresh(dbPath);
    } catch (error) {
      code = error instanceof FreshError ? error.code : `NOT_AN_INIT_ERROR:${String(error)}`;
    }

    // The control point must actually have fired, and the wait must have been satisfied
    // before it did — otherwise this would be testing the first check again.
    expect(linkedAfterWait).toBe(true);
    expect(code).toBe('E_DB_TARGET_ALIASED');
    expect(existsSync(alias)).toBe(true);
  });
});

// B2. A slow but legitimate publisher makes other callers time out. That outcome is
// retryable, and the retry has to be shown to succeed on its own terms — not by retrying an
// arbitrary number of times, and not by treating any error as eventual success.
describe('a publisher that holds its second name past the deadline', () => {
  it('times out once, then succeeds on a retry after the name is released', () => {
    initialise(dbPath);
    const held = join(dir, 'held-by-a-slow-publisher.tmp');
    linkSync(dbPath, held);

    // First attempt, while the second name is still held: exactly one timeout.
    const first = ((): string => {
      try {
        return initialise(dbPath).status;
      } catch (error) {
        return error instanceof InitError ? error.code : `NOT_AN_INIT_ERROR:${String(error)}`;
      }
    })();
    expect(first).toBe('E_DB_TARGET_ALIASED');

    // The publisher finishes and removes its own name. Exactly one retry follows.
    unlinkSync(held);
    const final = initialise(dbPath);

    // First and final results are asserted separately: the timeout was real, and the retry
    // succeeded for the right reason rather than by repetition.
    expect(final).toEqual({ status: 'already_at', version: 1, checksum: V1_CHECKSUM });
    expect(statSync(dbPath).nlink).toBe(1);
  });
});

// B1. The wait is bounded on a monotonic clock. A wall-clock deadline could be cut short by
// an adjustment, and the earlier revision's green mutation only showed that the existing
// tests did not distinguish the two — not that the difference is untestable. It is testable:
// the wall clock is moved forward past the deadline inside the real wait window, while
// monotonic time has barely advanced.
describe('a clock adjustment during the wait', () => {
  afterEach(() => { vi.doUnmock('node:fs'); vi.resetModules(); });

  it('does not cut the wait short, and classification completes normally', async () => {
    initialise(dbPath);
    const target = join(realpathSync(dir), 'orchestrator.sqlite');
    const extra = join(realpathSync(dir), 'second-name.tmp');
    linkSync(target, extra);

    let jumped = false;
    let released = false;
    let waitIterations = 0;
    const realNow = Date.now;
    let offset = 0;
    Date.now = (): number => realNow.call(Date) + offset;

    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        lstatSync(path: string, options?: unknown) {
          const stat = (actual.lstatSync as (p: string, o?: unknown) => { nlink: number })(path, options);
          if (path !== target || stat.nlink !== 2) return stat;
          // Only the wait polls a target that still has two names; the occupancy probe in
          // initialise saw the same count, so both are counted and both are asserted below.
          waitIterations += 1;
          if (waitIterations === 2) {
            // Inside the wait window: push the wall clock well past the deadline.
            offset += 5_000;
            jumped = true;
          }
          if (waitIterations === 3) {
            // The second name goes away before any later controlled check sees it.
            actual.unlinkSync(extra);
            released = true;
          }
          return stat;
        },
      };
    });

    try {
      const { initialise: fresh } = await import('../src/db/migrate.js');
      const outcome = fresh(dbPath);
      // Both control points must have fired, or this test proves nothing.
      expect(jumped).toBe(true);
      expect(released).toBe(true);
      expect(outcome.status).toBe('already_at');
    } finally {
      Date.now = realNow;
    }
    expect(existsSync(extra)).toBe(false);
    expect(statSync(dbPath).nlink).toBe(1);
  });
});
