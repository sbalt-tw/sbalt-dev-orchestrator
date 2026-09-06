import { describe, it, expect, beforeEach, afterEach, inject } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertFreshlyBuilt } from './build-cli.js';
import Database from 'better-sqlite3';
import { V1_CHECKSUM, V1_CREATE } from '../src/db/migrate.js';

// Built by this run into its own directory; never the repository's dist/.
const CLI = assertFreshlyBuilt(inject('cliPath'));

interface Result { status: number; stdout: string; stderr: string }

function runCli(args: string[]): Result {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'a1-cli-'));
  dbPath = join(dir, 'orchestrator.sqlite');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the compiled command line', () => {
  it('applies v1, then recognizes it in a second, separate process', () => {
    const first = runCli(['db:init', '--db', dbPath]);
    expect(first.status).toBe(0);
    expect(first.stdout.trim()).toBe(`db:init result=applied version=1 checksum=${V1_CHECKSUM}`);

    const second = runCli(['db:init', '--db', dbPath]);
    expect(second.status).toBe(0);
    expect(second.stdout.trim()).toBe(`db:init result=already_at version=1 checksum=${V1_CHECKSUM}`);
  });

  it('persists what the first process wrote, and the second process changes nothing', () => {
    runCli(['db:init', '--db', dbPath]);
    const before = createHash('sha256').update(readFileSync(dbPath)).digest('hex');
    runCli(['db:init', '--db', dbPath]);
    expect(createHash('sha256').update(readFileSync(dbPath)).digest('hex')).toBe(before);

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    expect(db.prepare('SELECT version, checksum FROM schema_migrations').all())
      .toEqual([{ version: 1, checksum: V1_CHECKSUM }]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    db.close();
    expect(readdirSync(dir)).toEqual(['orchestrator.sqlite']);
  });

  it('accepts the --db=<path> form', () => {
    expect(runCli([`db:init`, `--db=${dbPath}`]).status).toBe(0);
  });

  it.each([
    ['a missing --db', ['db:init'], 'E_DB_ARG_MISSING'],
    ['a relative path', ['db:init', '--db', 'relative.sqlite'], 'E_DB_PATH_NOT_ABSOLUTE'],
    ['an unknown command', ['db:nope'], 'E_DB_ARG_MISSING'],
  ])('refuses %s', (_label, args, code) => {
    const result = runCli(args as string[]);
    expect(result.status).toBe(1);
    expect(result.stderr.trim().startsWith(`db:init error=${code} `)).toBe(true);
    expect(result.stdout).toBe('');
  });

  it('refuses an existing empty file', () => {
    writeFileSync(dbPath, '');
    expect(runCli(['db:init', '--db', dbPath]).stderr).toContain('E_DB_EMPTY_FILE');
  });

  it('prints a reason code only, with no database content and no stack', () => {
    const db = new Database(dbPath);
    db.exec(V1_CREATE);
    db.exec(`INSERT INTO schema_migrations VALUES (7, 'a-secret-checksum-value', 'a-secret-timestamp')`);
    db.close();

    const result = runCli(['db:init', '--db', dbPath]);
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe('db:init error=E_UNKNOWN_VERSION the recorded migration version is not version 1');
    for (const secret of ['a-secret-checksum-value', 'a-secret-timestamp', '7', 'at ', 'Error:', dbPath]) {
      expect(result.stderr).not.toContain(secret);
    }
  });

  it('does not echo an unexpected argument back to the caller', () => {
    const result = runCli(['db:init', '--db', dbPath, '--injected-marker-9f3a']);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('injected-marker-9f3a');
  });
});
