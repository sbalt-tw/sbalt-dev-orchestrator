import { describe, it, expect, beforeEach, afterEach, inject } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertFreshlyBuilt } from './build-cli.js';
import Database from 'better-sqlite3';
import { V1_CHECKSUM, V1_CREATE } from '../src/db/migrate.js';

const CLI = assertFreshlyBuilt(inject('cliPath'));
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

/**
 * Starts every racer together. This synchronises process START only; it does not control the
 * window between "observed the target absent" and "published", so it cannot guarantee that
 * any process reaches the EEXIST branch — a sequential schedule would satisfy every
 * assertion below. It is therefore a PARALLEL SMOKE, not proof of contention. The
 * deterministic EEXIST evidence is the controlled-interleaving test in migrate.test.ts.
 */
function launchAllTogether(count: number): Promise<Outcome[]> {
  const started = Array.from({ length: count }, () => launch());
  return Promise.all(started);
}

describe('parallel smoke: several independent processes against one path', () => {
  it('publishes exactly one database, and no loser modifies the winner', async () => {
    // Real operating system processes, started together, all targeting one path.
    const outcomes = await launchAllTogether(RACERS);

    // F7. Every racer must succeed. Accepting "any number of losers may fail" would have
    // passed even if the EEXIST loser path stopped classifying and simply errored.
    const applied = outcomes.filter((o) => o.stdout.trim()
      === `db:init result=applied version=1 checksum=${V1_CHECKSUM}`);
    const alreadyAt = outcomes.filter((o) => o.stdout.trim()
      === `db:init result=already_at version=1 checksum=${V1_CHECKSUM}`);

    expect(applied).toHaveLength(1);
    expect(alreadyAt).toHaveLength(RACERS - 1);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe(0);
      expect(outcome.stderr).toBe('');
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

    const outcomes = await launchAllTogether(RACERS);
    for (const outcome of outcomes) {
      expect(outcome.stdout.trim()).toBe(`db:init result=already_at version=1 checksum=${V1_CHECKSUM}`);
      expect(outcome.status).toBe(0);
      expect(outcome.stderr).toBe('');
    }

    expect(createHash('sha256').update(readFileSync(dbPath)).digest('hex')).toBe(before);
    expect(readdirSync(dir)).toEqual(['orchestrator.sqlite']);
  });
});
