// A1: open a SQLite database and apply the immutable clean v1 migration.
//
// This module knows about exactly one migration and one table. It contains no Task, Lane,
// Project or orchestrator behaviour, and it accepts no SQL from a caller.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import Database from 'better-sqlite3';

export const REASON_CODES = [
  'E_DB_ARG_MISSING',
  'E_DB_PATH_NOT_ABSOLUTE',
  'E_DB_PARENT_MISSING',
  'E_DB_NOT_SQLITE',
  'E_FOREIGN_KEYS_NOT_ENABLED',
  'E_UNKNOWN_SCHEMA',
  'E_REGISTRY_MALFORMED',
  'E_UNKNOWN_VERSION',
  'E_VERSION_SEQUENCE',
  'E_CHECKSUM_MISMATCH',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export class InitError extends Error {
  constructor(readonly code: ReasonCode, message: string) {
    super(message);
    this.name = 'InitError';
  }
}

export interface Migration {
  readonly version: number;
  readonly statements: readonly string[];
}

/**
 * Version 1. Once merged this is immutable: correcting it means adding version 2, never
 * editing these statements, because the checksum recorded in every existing database is
 * derived from exactly these bytes.
 */
export const V1: Migration = Object.freeze({
  version: 1,
  statements: Object.freeze([
    'CREATE TABLE schema_migrations (\n'
    + '  version INTEGER PRIMARY KEY,\n'
    + '  checksum TEXT NOT NULL,\n'
    + '  applied_at TEXT NOT NULL\n'
    + ')',
  ]),
});

export const MIGRATIONS: readonly Migration[] = Object.freeze([V1]);

/**
 * dev-orch/migration-checksum/v1
 *
 * sha256 over UTF-8 of: "dev-orch/migration/v<version>\n" followed by the statements
 * joined with ";\n" and terminated with ";\n". The input is these frozen constants and
 * nothing else — never the database, never a rendered document, never a value the runner
 * has previously written and could read back.
 */
export const CHECKSUM_ALGORITHM = 'dev-orch/migration-checksum/v1';

export function canonicalBytes(migration: Migration): Buffer {
  const body = migration.statements.join(';\n');
  return Buffer.from(`dev-orch/migration/v${migration.version}\n${body};\n`, 'utf8');
}

export function checksumOf(migration: Migration): string {
  return createHash('sha256').update(canonicalBytes(migration)).digest('hex');
}

/** Runs `work` in one transaction. It commits only if `work` returns without throwing. */
export function withTransaction(db: Database.Database, work: () => void): void {
  db.transaction(work)();
}

export type InitStatus = 'applied' | 'already_at';

export interface InitOutcome {
  readonly status: InitStatus;
  readonly version: number;
  readonly checksum: string;
}

interface SchemaObject { name: string; type: string }
interface ColumnInfo { name: string; type: string; notnull: number; pk: number }
interface MigrationRow { version: number; checksum: string }

const EXPECTED_COLUMNS: ReadonlyArray<{ name: string; type: string; notnull: number; pk: number }> = [
  { name: 'version', type: 'INTEGER', notnull: 0, pk: 1 },
  { name: 'checksum', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'applied_at', type: 'TEXT', notnull: 1, pk: 0 },
];

function openDatabase(dbPath: string): Database.Database {
  let db: Database.Database;
  try {
    db = new Database(dbPath);
    db.pragma('schema_version');
  } catch {
    throw new InitError('E_DB_NOT_SQLITE', 'the path is not a readable SQLite database');
  }
  db.pragma('foreign_keys = ON');
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    db.close();
    throw new InitError('E_FOREIGN_KEYS_NOT_ENABLED', 'foreign key enforcement could not be enabled');
  }
  return db;
}

function readRegistry(db: Database.Database): MigrationRow[] {
  const columns = db.pragma('table_info(schema_migrations)') as ColumnInfo[];
  if (columns.length !== EXPECTED_COLUMNS.length) {
    throw new InitError('E_REGISTRY_MALFORMED', 'schema_migrations has an unexpected column count');
  }
  EXPECTED_COLUMNS.forEach((expected, index) => {
    const actual = columns[index];
    if (!actual || actual.name !== expected.name || actual.type !== expected.type
      || actual.notnull !== expected.notnull || actual.pk !== expected.pk) {
      throw new InitError('E_REGISTRY_MALFORMED', `schema_migrations column ${index + 1} does not match version 1`);
    }
  });

  const rows = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
    .all() as MigrationRow[];
  if (rows.length === 0) {
    throw new InitError('E_REGISTRY_MALFORMED', 'schema_migrations exists but records no applied version');
  }
  return rows;
}

function verifyRegistry(rows: MigrationRow[]): InitOutcome {
  const known = new Set(MIGRATIONS.map((m) => m.version));
  for (const row of rows) {
    if (!known.has(row.version)) {
      throw new InitError('E_UNKNOWN_VERSION', `version ${row.version} is not a known migration`);
    }
  }
  const expectedSequence = MIGRATIONS.slice(0, rows.length).map((m) => m.version);
  const actualSequence = rows.map((r) => r.version);
  if (actualSequence.length !== expectedSequence.length
    || actualSequence.some((v, i) => v !== expectedSequence[i])) {
    throw new InitError('E_VERSION_SEQUENCE', 'the applied versions are not a gap-free prefix of the registry');
  }

  const latest = MIGRATIONS[rows.length - 1];
  const recorded = rows[rows.length - 1];
  if (!latest || !recorded) {
    throw new InitError('E_VERSION_SEQUENCE', 'the applied versions do not resolve to a known migration');
  }
  const expected = checksumOf(latest);
  if (recorded.checksum !== expected) {
    throw new InitError('E_CHECKSUM_MISMATCH', `version ${latest.version} was applied from different bytes`);
  }
  return { status: 'already_at', version: latest.version, checksum: expected };
}

function applyV1(db: Database.Database): InitOutcome {
  const checksum = checksumOf(V1);
  const appliedAt = new Date().toISOString();
  withTransaction(db, () => {
    for (const statement of V1.statements) db.exec(statement);
    db.prepare('INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)')
      .run(V1.version, checksum, appliedAt);
  });
  return { status: 'applied', version: V1.version, checksum };
}

/**
 * Opens the database at `dbPath` and brings it to version 1, or confirms it is already
 * there. Every other state fails closed, and nothing is written before a state is refused.
 */
export function initialise(dbPath: string): InitOutcome {
  if (!isAbsolute(dbPath)) {
    throw new InitError('E_DB_PATH_NOT_ABSOLUTE', '--db must be an absolute path');
  }
  if (!existsSync(dirname(dbPath))) {
    throw new InitError('E_DB_PARENT_MISSING', 'the parent directory does not exist and is not created');
  }

  const db = openDatabase(dbPath);
  try {
    const objects = db.prepare("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
      .all() as SchemaObject[];

    if (objects.length === 0) return applyV1(db);

    const onlyRegistry = objects.length === 1
      && objects[0]?.name === 'schema_migrations'
      && objects[0]?.type === 'table';
    if (!onlyRegistry) {
      throw new InitError('E_UNKNOWN_SCHEMA', 'the database holds objects this runner did not create');
    }
    return verifyRegistry(readRegistry(db));
  } finally {
    db.close();
  }
}
