import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { V1_CHECKSUM, V1_CREATE } from '../src/db/migrate.js';

const CLI = resolve(import.meta.dirname, '..', 'dist', 'cli', 'index.js');
const RACERS = 6;

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'a1-race-'));
  dbPath = join(dir, 'orchestrator.sqlite');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Outcome { status: number; stdout: string; stderr: string }

function launch(): Promise<Outcome> {
  return new Promise((resolveOutcome) => {
    execFile(process.execPath, [CLI, 'db:init', '--db', dbPath], { encoding: 'utf8' },
      (error, stdout, stderr) => {
        const status = error ? ((error as { code?: number }).code ?? -1) : 0;
        resolveOutcome({ status, stdout, stderr });
      });
  });
}

describe('several independent processes initialising the same path at once', () => {
  it('publishes exactly one database, and no loser modifies the winner', async () => {
    // Real operating system processes, started together, all targeting one path.
    const outcomes = await Promise.all(Array.from({ length: RACERS }, () => launch()));

    const applied = outcomes.filter((o) => o.stdout.includes('result=applied'));
    const alreadyAt = outcomes.filter((o) => o.stdout.includes('result=already_at'));
    const failed = outcomes.filter((o) => o.status !== 0);

    // Exactly one process may create the database. Every other process either observed the
    // finished v1 or failed safely; none of them is allowed to have created a second one.
    expect(applied).toHaveLength(1);
    expect(applied.length + alreadyAt.length + failed.length).toBe(RACERS);
    for (const outcome of alreadyAt) {
      expect(outcome.stdout.trim()).toBe(`db:init result=already_at version=1 checksum=${V1_CHECKSUM}`);
    }
    for (const outcome of failed) {
      expect(outcome.stdout).toBe('');
      expect(outcome.stderr).toMatch(/^db:init error=E_[A-Z_]+ /);
    }

    // One legitimate database, nothing else: no temporary file, no journal, no write-ahead log.
    expect(readdirSync(dir)).toEqual(['orchestrator.sqlite']);

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    expect(db.prepare('SELECT type, name, sql FROM sqlite_master').all())
      .toEqual([{ type: 'table', name: 'schema_migrations', sql: V1_CREATE }]);
    expect(db.prepare('SELECT version, checksum FROM schema_migrations').all())
      .toEqual([{ version: 1, checksum: V1_CHECKSUM }]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    db.close();
  });

  it('leaves a database created by an earlier winner byte-identical', async () => {
    const first = await launch();
    expect(first.stdout).toContain('result=applied');
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const before = createHash('sha256').update(readFileSync(dbPath)).digest('hex');

    const outcomes = await Promise.all(Array.from({ length: RACERS }, () => launch()));
    for (const outcome of outcomes) expect(outcome.stdout).not.toContain('result=applied');

    expect(createHash('sha256').update(readFileSync(dbPath)).digest('hex')).toBe(before);
    expect(readdirSync(dir)).toEqual(['orchestrator.sqlite']);
  });
});
