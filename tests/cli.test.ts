import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// `npm test` builds first, so this exercises the compiled artifact the bin field points at.
const CLI = resolve(import.meta.dirname, '..', 'dist', 'cli', 'index.js');

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

describe('the compiled CLI', () => {
  it('exists at the path the bin field declares', () => {
    expect(existsSync(CLI), `${CLI} is missing — run npm run build`).toBe(true);
  });

  it('applies v1 on the first run and reports already_at on the second', () => {
    const first = runCli(['db:init', '--db', dbPath]);
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/^db:init result=applied version=1 checksum=[0-9a-f]{64}\n$/);

    const second = runCli(['db:init', '--db', dbPath]);
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(/^db:init result=already_at version=1 checksum=[0-9a-f]{64}\n$/);

    const checksum = (s: string) => s.trim().split('checksum=')[1];
    expect(checksum(second.stdout)).toBe(checksum(first.stdout));
  });

  it('accepts --db=<path> as well as --db <path>', () => {
    expect(runCli([`db:init`, `--db=${dbPath}`]).status).toBe(0);
  });

  it('refuses a missing --db', () => {
    const r = runCli(['db:init']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^db:init error=E_DB_ARG_MISSING /);
  });

  it('refuses a relative path', () => {
    const r = runCli(['db:init', '--db', 'relative.sqlite']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^db:init error=E_DB_PATH_NOT_ABSOLUTE /);
  });

  it('refuses an unknown command', () => {
    const r = runCli(['db:migrate', '--db', dbPath]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/usage: dev-orch db:init --db <absolute-path>/);
  });

  it('reports a reason code without printing database content', () => {
    writeFileSync(dbPath, 'not a database');
    const r = runCli(['db:init', '--db', dbPath]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^db:init error=E_DB_NOT_SQLITE /);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toMatch(/not a database/);
  });
});
