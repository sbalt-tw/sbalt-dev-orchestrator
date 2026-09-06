// A1: bring a SQLite database to the immutable clean v1 schema, or refuse it.
//
// Two paths, and only two. A path that does not exist is created by building a private
// temporary database and publishing it with a no-clobber link. A path that already exists
// is classified through a read-only connection and is never written, repaired or recovered.
//
// This module knows about exactly one migration and one table. It has no Task, Lane,
// Project, worker, lease, gate or scheduler concept, no multi-version machinery, and it
// accepts no SQL, no migration and no fault-injection payload from a caller.

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, fsyncSync, linkSync, lstatSync, openSync, realpathSync, rmSync, statSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, sep } from 'node:path';
import Database from 'better-sqlite3';

export const REASON_CODES = [
  'E_DB_ARG_MISSING',
  'E_DB_PATH_NOT_ABSOLUTE',
  'E_DB_PATH_NOT_CANONICAL',
  'E_DB_PARENT_MISSING',
  'E_DB_TARGET_NOT_REGULAR_FILE',
  'E_DB_NOT_SQLITE',
  'E_DB_BUSY',
  'E_DB_EMPTY_FILE',
  'E_DB_RECOVERY_REQUIRED',
  'E_FOREIGN_KEYS_NOT_ENABLED',
  'E_UNKNOWN_SCHEMA',
  'E_REGISTRY_MALFORMED',
  'E_UNKNOWN_VERSION',
  'E_CHECKSUM_MISMATCH',
  'E_CREATE_FAILED',
  'E_INTERNAL',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * Failure text is a fixed constant per code. Nothing read from the database, from the
 * filesystem, from a driver message or from the command line is ever interpolated into it,
 * so the output carries no database content and no attacker-controlled bytes.
 */
export const REASON_TEXT: Readonly<Record<ReasonCode, string>> = Object.freeze({
  E_DB_ARG_MISSING: 'usage: dev-orch db:init --db <absolute-path>',
  E_DB_PATH_NOT_ABSOLUTE: 'the database path must be absolute',
  E_DB_PATH_NOT_CANONICAL: 'the database path must be canonical: no ".", "..", repeated or trailing separator',
  E_DB_PARENT_MISSING: 'the parent directory does not exist and is not created',
  E_DB_TARGET_NOT_REGULAR_FILE: 'the target exists and is not a regular file',
  E_DB_NOT_SQLITE: 'the path is not a readable SQLite database',
  E_DB_BUSY: 'the database is locked by another process; retrying later may succeed',
  E_DB_EMPTY_FILE: 'the path exists but holds no schema',
  E_DB_RECOVERY_REQUIRED: 'the database has journal or write-ahead sidecars and needs recovery',
  E_FOREIGN_KEYS_NOT_ENABLED: 'foreign key enforcement could not be confirmed',
  E_UNKNOWN_SCHEMA: 'the database does not hold the recognized exact v1 schema',
  E_REGISTRY_MALFORMED: 'the migration registry does not match the recognized exact v1 shape',
  E_UNKNOWN_VERSION: 'the recorded migration version is not version 1',
  E_CHECKSUM_MISMATCH: 'the recorded checksum does not match version 1',
  E_CREATE_FAILED: 'the database could not be created',
  E_INTERNAL: 'the command failed',
});

export class InitError extends Error {
  constructor(readonly code: ReasonCode) {
    super(REASON_TEXT[code]);
    this.name = 'InitError';
  }
}

export interface Migration {
  readonly version: number;
  readonly statements: readonly string[];
}

/**
 * The one statement of version 1. SQLite stores a CREATE statement verbatim, so this exact
 * text is also what a recognized database reports back in sqlite_master.sql, which is how a
 * forged registry carrying extra constraints is refused.
 */
export const V1_CREATE = 'CREATE TABLE schema_migrations (\n'
  + '  version INTEGER PRIMARY KEY,\n'
  + '  checksum TEXT NOT NULL,\n'
  + '  applied_at TEXT NOT NULL\n'
  + ')';

/**
 * Version 1 is immutable. Correcting it means shipping a separate capability that
 * introduces version 2; it never means editing these bytes, because V1_CHECKSUM below is
 * recorded in every database this runner has created.
 */
export const V1: Migration = Object.freeze({
  version: 1,
  statements: Object.freeze([V1_CREATE]),
});

/**
 * dev-orch/migration-checksum/v2
 *
 * The preimage is the domain string, then the version, then the statement count, then each
 * statement preceded by its exact UTF-8 byte length. Every variable-length part is length
 * prefixed, so distinct migrations cannot share a preimage: the v1 scheme joined statements
 * with ";\n", which let ['SELECT 1 --', 'SELECT 2'] and ['SELECT 1 --;\nSELECT 2'] encode
 * identically. The domain string is part of the preimage rather than a decorative constant.
 *
 * The input is these frozen constants and nothing else — never the database, never a
 * rendered document, never a value this runner previously wrote and could read back.
 */
export const CHECKSUM_ALGORITHM = 'dev-orch/migration-checksum/v2';

export function canonicalBytes(migration: Migration): Buffer {
  const parts = [
    Buffer.from(`${CHECKSUM_ALGORITHM}\n`, 'utf8'),
    Buffer.from(`version:${migration.version}\n`, 'utf8'),
    Buffer.from(`statements:${migration.statements.length}\n`, 'utf8'),
  ];
  for (const statement of migration.statements) {
    const body = Buffer.from(statement, 'utf8');
    parts.push(Buffer.from(`len:${body.length}\n`, 'utf8'), body, Buffer.from('\n', 'utf8'));
  }
  return Buffer.concat(parts);
}

export function checksumOf(migration: Migration): string {
  return createHash('sha256').update(canonicalBytes(migration)).digest('hex');
}

/**
 * The frozen identity of version 1, written here as a literal rather than computed from V1.
 * Production compares a database against this constant, so editing V1 makes the checksum
 * test fail instead of silently redefining what every existing database should contain.
 */
export const V1_CHECKSUM = 'f2e2aa4ad993a7b4562db35e1e1196dd4843470440e36b942dc87843ef6782c8';

export type InitStatus = 'applied' | 'already_at';

export interface InitOutcome {
  readonly status: InitStatus;
  readonly version: number;
  readonly checksum: string;
}

interface MasterRow { type: string; name: string; sql: string | null }

/**
 * F9. A database held by another process is valid, not malformed. Contention is reported
 * under its own retryable code instead of being flattened into "not a SQLite database" or
 * escaping as an unclassified failure.
 */
function classifyDriverFailure(error: unknown): InitError {
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED'))) {
    return new InitError('E_DB_BUSY');
  }
  return new InitError('E_DB_NOT_SQLITE');
}
interface RegistryRow { version: unknown; checksum: unknown }

/** Sidecars that mean the database is mid-transaction or in a mode this runner never uses. */
const SIDECAR_SUFFIXES = ['-journal', '-wal', '-shm'] as const;

/**
 * Classifies an existing path without writing to it. The connection is read-only and
 * requires the file to exist, so it cannot create a file, and refusing never repairs,
 * recovers or reopens the target for writing — including on the success path, which
 * reports from this same read-only connection.
 */
function classifyExisting(dbPath: string): InitOutcome {
  refuseRecoverySidecars(dbPath);
  // lstat, never stat: a symlink in the target position is refused as a target kind, and
  // is never resolved and classified as though it were the database itself.
  const stat = lstatSync(dbPath);
  if (!stat.isFile()) throw new InitError('E_DB_TARGET_NOT_REGULAR_FILE');
  if (stat.size === 0) throw new InitError('E_DB_EMPTY_FILE');

  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw classifyDriverFailure(error);
  }
  try {
    return classifyInOneSnapshot(db);
  } finally {
    db.close();
  }
}

/**
 * F3. The schema and the registry are read inside one explicit read transaction, so they
 * describe a single state of the database. Read as two autocommit statements they did not:
 * a writer could commit between them, and the classifier could combine the schema of one
 * state with the version row of another and accept a database that was never valid.
 */
function classifyInOneSnapshot(db: Database.Database): InitOutcome {
  try {
    db.exec('BEGIN DEFERRED');
  } catch (error) {
    throw classifyDriverFailure(error);
  }
  try {
    let master: MasterRow[];
    try {
      master = db.prepare('SELECT type, name, sql FROM sqlite_master').all() as MasterRow[];
    } catch (error) {
      throw classifyDriverFailure(error);
    }

    // The whole schema is compared, with no name predicate of any kind. A table such as
    // "sqliteXevil" is an ordinary extra object here and is refused like any other.
    //
    // SQLite stores a CREATE statement verbatim, so comparing sqlite_master.sql to the
    // exact v1 text settles every column name, declared type, NOT NULL, default, primary
    // key, conflict clause and table constraint at once. A separate table_xinfo comparison
    // was removed after mutation testing showed no input could ever make it fire.
    const only = master[0];
    if (master.length !== 1 || !only
      || only.type !== 'table' || only.name !== 'schema_migrations' || only.sql !== V1_CREATE) {
      throw new InitError('E_UNKNOWN_SCHEMA');
    }

    let rows: RegistryRow[];
    try {
      rows = db.prepare('SELECT version, checksum FROM schema_migrations').all() as RegistryRow[];
    } catch (error) {
      throw classifyDriverFailure(error);
    }
    const row = rows[0];
    if (rows.length !== 1 || !row) throw new InitError('E_REGISTRY_MALFORMED');
    if (row.version !== V1.version) throw new InitError('E_UNKNOWN_VERSION');
    if (row.checksum !== V1_CHECKSUM) throw new InitError('E_CHECKSUM_MISMATCH');
    return { status: 'already_at', version: V1.version, checksum: V1_CHECKSUM };
  } finally {
    // A read transaction holds only a shared lock, and ending it promptly is what lets a
    // waiting writer proceed instead of contending with a classifier that has already
    // finished reading.
    db.exec('COMMIT');
  }
}

/**
 * F2. Recovery sidecars are refused before the branch between classification and creation.
 * They used to be checked only when the target already existed, so a directory holding a
 * stale `-journal` beside an absent database reported `applied` on the first run and
 * `E_DB_RECOVERY_REQUIRED` on the second — the one promised capability, broken.
 *
 * Only ENOENT counts as absence: a dangling sidecar symlink, or a metadata error, refuses
 * rather than failing open.
 */
function refuseRecoverySidecars(dbPath: string): void {
  for (const suffix of SIDECAR_SUFFIXES) {
    try {
      lstatSync(dbPath + suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new InitError('E_DB_RECOVERY_REQUIRED');
    }
    throw new InitError('E_DB_RECOVERY_REQUIRED');
  }
}

/**
 * Builds v1 in a private temporary database in the target's own directory, then publishes
 * it with link(), which fails rather than replacing an existing target. A loser therefore
 * cannot overwrite, truncate or modify the winner; it removes only its own temporary file
 * and then classifies whatever the winner published. rename() is deliberately not used,
 * because its POSIX semantics replace the destination silently.
 */
function createAtomically(dbPath: string): InitOutcome {
  // The temporary database lives in the target's own resolved directory, so link() stays
  // within one filesystem and the publication is a rename-free, no-clobber operation.
  const temporary = join(dirname(dbPath), `.dev-orch-init-${process.pid}-${randomUUID()}.tmp`);
  try {
    buildV1(temporary);
    const built = statSync(temporary);
    try {
      linkSync(temporary, dbPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return classifyExisting(dbPath);
      throw new InitError('E_CREATE_FAILED');
    }
    // Re-establish identity rather than trust the earlier checks: the published name must
    // be a regular file, and the very inode this runner just verified.
    const published = lstatSync(dbPath);
    if (!published.isFile() || published.ino !== built.ino || published.dev !== built.dev) {
      throw new InitError('E_CREATE_FAILED');
    }
    // F10. The directory entry is flushed before success is reported, and a failure to
    // flush is reported as a failure rather than swallowed. Real power-loss durability is
    // filesystem-dependent and is not claimed.
    fsyncPath(dirname(dbPath));
    return { status: 'applied', version: V1.version, checksum: V1_CHECKSUM };
  } finally {
    for (const suffix of ['', ...SIDECAR_SUFFIXES]) rmSync(temporary + suffix, { force: true });
  }
}

/**
 * F6. The one production migration transaction: the schema object and the version row
 * commit together or not at all. It is not exported and takes no callback — a test observes
 * rollback on the real connection instead of being handed an injection seam.
 */
function runV1Transaction(db: Database.Database): void {
  db.transaction(() => {
    db.exec(V1_CREATE);
    db.prepare('INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)')
      .run(V1.version, V1_CHECKSUM, new Date().toISOString());
  })();
}

/** Flushes one path's own metadata. Any failure propagates; nothing here reports success. */
function fsyncPath(target: string): void {
  let fd: number;
  try {
    fd = openSync(target, 'r');
  } catch {
    throw new InitError('E_CREATE_FAILED');
  }
  try {
    fsyncSync(fd);
  } catch {
    throw new InitError('E_CREATE_FAILED');
  } finally {
    closeSync(fd);
  }
}

function buildV1(temporary: string): void {
  let db: Database.Database;
  try {
    db = new Database(temporary);
  } catch {
    throw new InitError('E_CREATE_FAILED');
  }
  try {
    db.pragma('foreign_keys = ON');
    if (db.pragma('foreign_keys', { simple: true }) !== 1) {
      throw new InitError('E_FOREIGN_KEYS_NOT_ENABLED');
    }
    runV1Transaction(db);
  } catch (error) {
    db.close();
    throw error instanceof InitError ? error : new InitError('E_CREATE_FAILED');
  }
  db.close();
  // F10. Flush the file's own contents, then let classification confirm the shape. The
  // parent directory entry is flushed later, once the name has been published.
  fsyncPath(temporary);
  // Publish only what this runner can itself recognize as the exact v1 shape.
  classifyExisting(temporary);
}

/**
 * Brings `dbPath` to version 1, or confirms it is already exactly there. Only a path that
 * does not yet exist is initialised; every existing path is classified read-only and either
 * recognized or refused.
 */
export function initialise(dbPath: string): InitOutcome {
  const target = canonicalTarget(dbPath);
  // Before choosing a branch: a recovery sidecar disqualifies the target whether or not the
  // database itself is there.
  refuseRecoverySidecars(target);
  // lstat decides existence, so a dangling symlink counts as an occupied target and is
  // refused by kind rather than falling through to creation.
  let occupied = true;
  try {
    lstatSync(target);
  } catch {
    occupied = false;
  }
  return occupied ? classifyExisting(target) : createAtomically(target);
}

/**
 * Accepts only a platform-native, lexically canonical absolute path whose parent already
 * exists, and returns the target rebuilt on the parent's realpath. Everything downstream —
 * the temporary database, classification and publication — uses that resolved form, so a
 * symlinked parent is resolved exactly once and never re-derived from the original text.
 */
function canonicalTarget(dbPath: string): string {
  if (dbPath === '' || !isAbsolute(dbPath)) throw new InitError('E_DB_PATH_NOT_ABSOLUTE');
  // normalize() collapses ".", ".." and repeated separators but keeps a trailing one, so
  // these two comparisons together reject every non-canonical spelling.
  //
  // F1. Canonical also means "the name this runner uses is the name the driver opens".
  // better-sqlite3 trims the filename before handing it to SQLite, so a path with leading
  // or trailing whitespace was linked under one name and opened under another: the first
  // run reported applied and the second could not find, or could misidentify, the database.
  if (dbPath !== normalize(dbPath) || dbPath.endsWith(sep) || dbPath !== dbPath.trim()) {
    throw new InitError('E_DB_PATH_NOT_CANONICAL');
  }
  // No basename check: normalize() collapses "." and "..", "/" is the only path with an
  // empty basename, and mutation testing confirmed a standalone guard can never fire.
  const name = basename(dbPath);

  let parent: string;
  try {
    parent = realpathSync(dirname(dbPath));
  } catch {
    throw new InitError('E_DB_PARENT_MISSING');
  }
  if (!statSync(parent).isDirectory()) throw new InitError('E_DB_PARENT_MISSING');
  return join(parent, name);
}
