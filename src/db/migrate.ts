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
  closeSync, fsyncSync, linkSync, lstatSync, openSync, readSync, realpathSync, rmSync, statSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, sep } from 'node:path';
import Database from 'better-sqlite3';

export const REASON_CODES = [
  'E_PLATFORM_UNSUPPORTED',
  'E_DB_ARG_MISSING',
  'E_DB_ARG_REPEATED',
  'E_DB_PATH_NOT_ABSOLUTE',
  'E_DB_PATH_NOT_CANONICAL',
  'E_DB_PATH_SIDECAR_RESERVED',
  'E_DB_PARENT_MISSING',
  'E_DB_TARGET_NOT_REGULAR_FILE',
  'E_DB_TARGET_ALIASED',
  'E_DB_NOT_SQLITE',
  'E_DB_UNSUPPORTED_FORMAT',
  'E_DB_BUSY',
  'E_DB_EMPTY_FILE',
  'E_DB_RECOVERY_REQUIRED',
  'E_FOREIGN_KEYS_NOT_ENABLED',
  'E_UNKNOWN_SCHEMA',
  'E_REGISTRY_MALFORMED',
  'E_UNKNOWN_VERSION',
  'E_CHECKSUM_MISMATCH',
  'E_CREATE_FAILED',
  'E_PUBLISHED_IDENTITY_UNCONFIRMED',
  'E_PUBLISHED_NOT_SYNCED',
  'E_TEMPORARY_NOT_REMOVED',
  'E_INTERNAL',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * Failure text is a fixed constant per code. Nothing read from the database, from the
 * filesystem, from a driver message or from the command line is ever interpolated into it,
 * so the output carries no database content and no attacker-controlled bytes.
 */
export const REASON_TEXT: Readonly<Record<ReasonCode, string>> = Object.freeze({
  E_PLATFORM_UNSUPPORTED: 'this platform is not supported; only Linux and macOS are',
  E_DB_ARG_MISSING: 'usage: dev-orch db:init --db <absolute-path>',
  E_DB_ARG_REPEATED: '--db was given more than once; the intended database is ambiguous',
  E_DB_PATH_NOT_ABSOLUTE: 'the database path must be absolute',
  E_DB_PATH_NOT_CANONICAL: 'the database path must be canonical: no ".", "..", repeated or trailing separator',
  E_DB_PATH_SIDECAR_RESERVED: 'the database name may not end in "-journal", "-wal" or "-shm"; '
    + 'those names are reserved for the recovery sidecars of another database',
  E_DB_PARENT_MISSING: 'the parent directory does not exist and is not created',
  E_DB_TARGET_NOT_REGULAR_FILE: 'the target exists and is not a regular file',
  E_DB_TARGET_ALIASED: 'the target still has more than one name, so it does not yet meet the '
    + 'conditions for classification; a later attempt may succeed',
  E_DB_NOT_SQLITE: 'the path is not a readable SQLite database',
  E_DB_UNSUPPORTED_FORMAT: 'the database is not in the supported rollback-journal format',
  E_DB_BUSY: 'the database is locked by another process; retrying later may succeed',
  E_DB_EMPTY_FILE: 'the path exists but holds no schema',
  E_DB_RECOVERY_REQUIRED: 'the database has journal or write-ahead sidecars and needs recovery',
  E_FOREIGN_KEYS_NOT_ENABLED: 'foreign key enforcement could not be confirmed',
  E_UNKNOWN_SCHEMA: 'the database does not hold the recognized exact v1 schema',
  E_REGISTRY_MALFORMED: 'the migration registry does not match the recognized exact v1 shape',
  E_UNKNOWN_VERSION: 'the recorded migration version is not version 1',
  E_CHECKSUM_MISMATCH: 'the recorded checksum does not match version 1',
  E_CREATE_FAILED: 'the database could not be created',
  E_PUBLISHED_IDENTITY_UNCONFIRMED: 'the database was published but its identity could not be '
    + 'confirmed afterwards; the target may exist and has not been removed',
  E_PUBLISHED_NOT_SYNCED: 'the database was published but its durability is unconfirmed; '
    + 'the target may exist and has not been removed',
  // Deliberately says nothing about whether this run published or synced anything: it is
  // also reached after losing a race, where this run published nothing and the winner's
  // durability is not this run's to attest.
  E_TEMPORARY_NOT_REMOVED: 'this runner could not remove its own temporary file; '
    + 'no target was removed',
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
 * The one statement of version 1. SQLite normalizes a CREATE statement when it stores it,
 * but the normalization is deterministic, so a database created from exactly this text
 * reports exactly this text back in sqlite_master.sql — which is how a forged registry
 * carrying extra constraints is refused.
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

/**
 * True when every code point is a real character. Iterating a string yields code points, so
 * a correctly paired surrogate appears once above U+FFFF, while an unpaired one surfaces in
 * the surrogate range and is rejected.
 */
function isWellFormed(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}

export function canonicalBytes(migration: Migration): Buffer {
  // A JavaScript string may hold an unpaired surrogate, and UTF-8 encoding replaces it with
  // U+FFFD. Two different declared migrations could therefore encode to the same bytes, so
  // an ill-formed statement is refused rather than silently rewritten. Encoding here is
  // injective over well-formed strings; SHA-256 collision resistance is a separate and
  // unproven assumption, not a mathematical impossibility.
  // The legal input domain: a positive safe integer version, and well-formed statements.
  // The version was interpolated unchecked, so 0 and -0, and 1 and '1', encoded identically.
  // A1's only production caller is the frozen V1 constant, which cannot supply an illegal
  // value; this closes the exported encoder rather than a reachable production path.
  if (typeof migration.version !== 'number' || !Number.isSafeInteger(migration.version)
    || migration.version < 1) {
    throw new InitError('E_INTERNAL');
  }
  for (const statement of migration.statements) {
    if (!isWellFormed(statement)) throw new InitError('E_INTERNAL');
  }
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

/**
 * A1 supports Linux and macOS on a local filesystem. Windows is not supported: the durable
 * publication below flushes a directory, which Windows does not provide through this API.
 * The check runs before anything touches the target, so an unsupported platform never opens,
 * creates or modifies a database.
 */
const SUPPORTED_PLATFORMS: readonly string[] = ['linux', 'darwin'];

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');
const HEADER_BYTES = 100;
const WRITE_VERSION_OFFSET = 18;
const READ_VERSION_OFFSET = 19;

/** Sidecars that mean the database is mid-transaction or in a mode this runner never uses. */
const SIDECAR_SUFFIXES = ['-journal', '-wal', '-shm'] as const;

// A publication makes the target and this runner's temporary name the same inode for a
// moment, so a second name is not automatically an error. It is also not automatically
// harmless, so it is waited out rather than excused, under a deadline.
//
// The deadline bounds the waiting strategy. It is not a promise that the command as a whole
// finishes within any number of seconds: the process can be descheduled and a filesystem call
// can block for as long as the operating system takes.
const ALIAS_WAIT_NS = 2_000n * 1_000_000n;
const ALIAS_POLL_MS = 25;

/**
 * Classifies an existing path without writing to it. The connection is read-only and
 * requires the file to exist, so it cannot create a file, and refusing never repairs,
 * recovers or reopens the target for writing — including on the success path, which
 * reports from this same read-only connection.
 */
function classifyExisting(dbPath: string): InitOutcome {
  // First, because everything after it must be judged on the state that exists once the
  // target has a single name — nothing observed before the wait is carried across it.
  waitForSingleLink(dbPath);

  refuseRecoverySidecars(dbPath);
  // lstat, never stat: a symlink in the target position is refused as a target kind, and
  // is never resolved and classified as though it were the database itself.
  const stat = lstatSync(dbPath);
  if (!stat.isFile()) throw new InitError('E_DB_TARGET_NOT_REGULAR_FILE');
  // Re-confirmed here rather than trusted from the wait: the link count is part of the
  // state this classification is about to rely on.
  if (stat.nlink !== 1) throw new InitError('E_DB_TARGET_ALIASED');
  if (stat.size === 0) throw new InitError('E_DB_EMPTY_FILE');
  refuseUnsupportedFormat(dbPath);

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
 *
 * Only these two reads share that transaction. The checks that run before it — link count,
 * sidecars, file kind and size, and the header — are filesystem operations made outside any
 * SQLite transaction, and each observes its own moment.
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
    // SQLite normalizes the CREATE statement it stores, deterministically, so comparing
    // sqlite_master.sql to the exact v1 text settles every column name, declared type, NOT
    // NULL, default, primary key, conflict clause and table constraint at once. A separate
    // table_xinfo comparison was removed after mutation testing showed it could never fire.
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
/**
 * Waits, with a deadline, for the target to have exactly one name.
 *
 * Recovery is detected by looking for a sidecar named after the path that was given, and
 * SQLite derives the journal name the same way. A database reachable under two names can
 * therefore have a hot journal beside the *other* name: `a.sqlite` is correctly refused
 * while `a-alias.sqlite`, the same inode, was reported `already_at` with recovery still
 * pending. No attacker and no path substitution is needed, so this is not covered by the
 * accepted TOCTOU limitation.
 *
 * A second name is not automatically permanent: publishing makes the target and this
 * runner's temporary file one inode until the temporary name is removed, and a loser
 * classifying the winner's database can see that moment. So the count is waited out rather
 * than excused. Nothing belonging to anyone else is removed to make it settle.
 *
 * Timing out says only that the target does not yet meet the conditions for classification.
 * It is not evidence that the extra name is permanent, that the database is damaged, or that
 * a retry will fail again — a legitimate publisher that was slow produces exactly this
 * outcome, and the caller may retry.
 */
function waitForSingleLink(dbPath: string): void {
  // Monotonic: a wall-clock deadline can be shortened or extended indefinitely by a clock
  // adjustment, which would make "bounded" untrue in both directions.
  const startedAt = process.hrtime.bigint();
  for (;;) {
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(dbPath);
    } catch {
      throw new InitError('E_DB_TARGET_NOT_REGULAR_FILE');
    }
    if (!stat.isFile()) throw new InitError('E_DB_TARGET_NOT_REGULAR_FILE');
    if (stat.nlink === 1) return;
    if (process.hrtime.bigint() - startedAt >= ALIAS_WAIT_NS) {
      throw new InitError('E_DB_TARGET_ALIASED');
    }
    sleepBriefly(ALIAS_POLL_MS);
  }
}

/** A synchronous pause; this module has no asynchronous path to yield to. */
function sleepBriefly(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Reads the SQLite header from the file itself, before any connection exists.
 *
 * A cleanly closed write-ahead-log database leaves no `-wal` or `-shm` behind, so the sidecar
 * check above cannot see it — and merely opening such a database read-only makes SQLite
 * create those files, because it opens the log itself read-write. That turned a recognized
 * database into one this runner then refused on the next run. The journal format is therefore
 * settled from the bytes on disk: only read version 1 and write version 1, the rollback
 * journal format, are accepted. Nothing is converted, no sidecar is removed, and the
 * `immutable` open flag is deliberately not used to paper over the check.
 */
function refuseUnsupportedFormat(dbPath: string): void {
  const header = Buffer.alloc(HEADER_BYTES);
  let fd: number;
  try {
    fd = openSync(dbPath, 'r');
  } catch {
    throw new InitError('E_DB_NOT_SQLITE');
  }
  let read: number;
  try {
    read = readSync(fd, header, 0, HEADER_BYTES, 0);
  } catch {
    throw new InitError('E_DB_NOT_SQLITE');
  } finally {
    closeSync(fd);
  }
  if (read < HEADER_BYTES || !header.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)) {
    throw new InitError('E_DB_NOT_SQLITE');
  }
  // Offsets 18 and 19 are the write and read format versions. 1 is the rollback journal;
  // 2 is the write-ahead log; anything else is a format this runner does not know.
  if (header[WRITE_VERSION_OFFSET] !== 1 || header[READ_VERSION_OFFSET] !== 1) {
    throw new InitError('E_DB_UNSUPPORTED_FORMAT');
  }
}

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
  // Four facts, recorded separately, because none of them stands for another: whether this
  // run published a target, whether the published name was afterwards confirmed to be the
  // inode this run verified, whether the directory entry was flushed, and whether this run
  // managed to remove its own temporary file. A single exit reads them and decides.
  //
  // Every failure after publication used to collapse into whatever error happened to
  // propagate — a post-link lstat failure surfaced as E_INTERNAL — and an exception from
  // cleanup in `finally` replaced the error already in flight.
  const temporary = join(dirname(dbPath), `.dev-orch-init-${process.pid}-${randomUUID()}.tmp`);
  let published = false;
  let identityConfirmed = false;
  let outcome: InitOutcome | undefined;
  let primary: unknown;
  let cleanupSucceeded: boolean;

  try {
    buildV1(temporary);
    const built = statSync(temporary);
    try {
      // The temporary database lives in the target's own resolved directory, so link() stays
      // within one filesystem and the publication is a rename-free, no-clobber operation.
      linkSync(temporary, dbPath);
      published = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new InitError('E_CREATE_FAILED');
      // Lost the race. This run published nothing; it reports on the winner's database and
      // makes no claim about the winner's durability.
      outcome = classifyExisting(dbPath);
    }
    if (published) {
      // Re-establish identity rather than trust the earlier checks: the published name must
      // be a regular file, and the very inode this runner just verified.
      const stat = lstatSync(dbPath);
      if (!stat.isFile() || stat.ino !== built.ino || stat.dev !== built.dev) {
        throw new InitError('E_PUBLISHED_IDENTITY_UNCONFIRMED');
      }
      identityConfirmed = true;
      // The directory entry is flushed before success is reported. Real power-loss
      // durability is filesystem-dependent and is not claimed. A published target is never
      // removed on failure: deleting it to simulate a rollback would destroy state this
      // runner had already handed over.
      fsyncPath(dirname(dbPath));
      outcome = { status: 'applied', version: V1.version, checksum: V1_CHECKSUM };
    }
  } catch (error) {
    primary = error;
  } finally {
    cleanupSucceeded = removeOwnTemporary(temporary);
  }

  // One exit. A primary error keeps its meaning and carries the publication state with it;
  // cleanup can never overwrite it. With no primary error, a cleanup failure is reported
  // rather than silently succeeding.
  if (primary !== undefined) throw describeFailure(primary, published, identityConfirmed);
  if (!cleanupSucceeded) throw new InitError('E_TEMPORARY_NOT_REMOVED');
  if (!outcome) throw new InitError('E_CREATE_FAILED');
  return outcome;
}

/** Reports what this run actually did, not merely what threw. */
function describeFailure(error: unknown, published: boolean, identityConfirmed: boolean): InitError {
  if (!published) return error instanceof InitError ? error : new InitError('E_CREATE_FAILED');
  if (!identityConfirmed) return new InitError('E_PUBLISHED_IDENTITY_UNCONFIRMED');
  return new InitError('E_PUBLISHED_NOT_SYNCED');
}

/** Removes only this run's own temporary artifacts. Never throws, and never reports a
 * failure as success. `force` already treats an absent file as removed. */
function removeOwnTemporary(temporary: string): boolean {
  let ok = true;
  for (const suffix of ['', ...SIDECAR_SUFFIXES]) {
    try {
      rmSync(temporary + suffix, { force: true });
    } catch {
      ok = false;
    }
  }
  return ok;
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
  // Before the path is even examined: an unsupported platform must not touch a database.
  if (!SUPPORTED_PLATFORMS.includes(process.platform)) {
    throw new InitError('E_PLATFORM_UNSUPPORTED');
  }
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

  // Recovery is detected by looking for "<target>-journal", "<target>-wal" and "<target>-shm".
  // A database whose own name ends in one of those suffixes therefore sits inside another
  // database's recovery namespace: once both exist — each created by an ordinary db:init —
  // reopening the shorter name reports E_DB_RECOVERY_REQUIRED for what is really a second,
  // healthy database. The namespace is reserved here, in the one shared validator, before any
  // temporary or target file is created and without consulting the filesystem, so the refusal
  // does not depend on which database was created first, or on the other one existing at all.
  //
  // The comparison is case-insensitive on every platform. macOS is supported and its default
  // APFS volumes are case-insensitive, so "a.sqlite-JOURNAL" and "a.sqlite-journal" are one
  // directory entry there. Applying the stricter rule uniformly also keeps a path that is
  // refused on one supported platform from being accepted on another.
  const foldedName = name.toLowerCase();
  if (SIDECAR_SUFFIXES.some((suffix) => foldedName.endsWith(suffix))) {
    throw new InitError('E_DB_PATH_SIDECAR_RESERVED');
  }

  let parent: string;
  try {
    parent = realpathSync(dirname(dbPath));
  } catch {
    throw new InitError('E_DB_PARENT_MISSING');
  }
  if (!statSync(parent).isDirectory()) throw new InitError('E_DB_PARENT_MISSING');
  return join(parent, name);
}
