import { describe, it, expect, beforeEach, afterEach, inject } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  writeFileSync,
} from 'node:fs';
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

// An ambiguous command line is refused before any database work, so neither candidate path
// is created. `--db /a --db /b` used to initialise /b, and `--db= --db=/b` even slipped past
// the empty-value refusal.
describe('an ambiguous --db', () => {
  // The contract is "the first argument error wins", so each form is pinned to the exact code
  // it actually produces. An oracle that accepted either code could not show which rule
  // applied — and the empty-value-first case really does report MISSING, because the value is
  // validated before a second occurrence is ever seen.
  it.each([
    ['two spaced forms', (a: string, b: string) => ['db:init', '--db', a, '--db', b], 'E_DB_ARG_REPEATED'],
    ['two joined forms', (a: string, b: string) => ['db:init', `--db=${a}`, `--db=${b}`], 'E_DB_ARG_REPEATED'],
    ['mixed forms', (a: string, b: string) => ['db:init', '--db', a, `--db=${b}`], 'E_DB_ARG_REPEATED'],
    ['mixed forms, joined first', (a: string, b: string) => ['db:init', `--db=${a}`, '--db', b], 'E_DB_ARG_REPEATED'],
    ['an empty value first', (_a: string, b: string) => ['db:init', '--db=', `--db=${b}`], 'E_DB_ARG_MISSING'],
    ['an empty value second', (a: string, _b: string) => ['db:init', `--db=${a}`, '--db='], 'E_DB_ARG_REPEATED'],
  ])('refuses %s with exactly %#, and creates neither path', (_label, build, code) => {
    const first = join(dir, 'first.sqlite');
    const second = join(dir, 'second.sqlite');
    const result = runCli(build(first, second));
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim().startsWith(`db:init error=${code} `)).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('names the repetition rather than the usage when --db is given twice', () => {
    const result = runCli(['db:init', '--db', join(dir, 'a.sqlite'), '--db', join(dir, 'b.sqlite')]);
    expect(result.stderr.trim())
      .toBe('db:init error=E_DB_ARG_REPEATED --db was given more than once; the intended database is ambiguous');
  });

  it('refuses an empty value on its own', () => {
    expect(runCli(['db:init', '--db=']).stderr).toContain('E_DB_ARG_MISSING');
    expect(readdirSync(dir)).toEqual([]);
  });
});

// F22. Round 13. With no listener attached, SIGINT and SIGTERM take their default action and the
// process dies without unwinding JavaScript, so the `finally` that removes this run's temporary
// name never ran. A signal between the publication link and that cleanup left the target and the
// temporary as two names for one inode, and every later run refused with E_DB_TARGET_ALIASED.
//
// The signal is a real one from the operating system, sent to a real child running the compiled
// CLI — not a handler called directly and not an emitted event. It is not fired on a timer: the
// test polls for the *target* name, which appears exactly when linkSync returns, so the child is
// inside the window by construction. Measured on this machine the window is 7-9 ms and the signal
// is sent within about 10 microseconds of the name appearing.
//
// The oracle is the resulting state, not the exit disposition. db:init is one synchronous block
// and Node dispatches signals only between event-loop turns, so with the fix in place the command
// normally completes before the signal is ever delivered to JavaScript and the child exits 0.
// Asserting death-by-signal would therefore fail against a working fix. What is asserted is what
// the defect was about: nothing of this run's own is left behind, and the promised repeat run
// works. Against this same window the unfixed CLI stranded a temporary in 10 of 10 runs.
describe('a real interrupt during publication', () => {
  /** `hit` records that the signal was accepted by the kernel while the child was inside the
   *  window; the disposition and the output are asserted separately. */
  interface Attempt {
    hit: boolean;
    code: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
  }

  function interruptDuringPublication(target: string, signal: 'SIGINT' | 'SIGTERM'): Promise<Attempt> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, 'db:init', '--db', target], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      // The target name appears exactly when linkSync returns, so its existence means the child
      // is between publication and cleanup. Polling rather than fs.watch: on macOS that is
      // FSEvents-backed and reports tens of milliseconds late, long after this window closes.
      let fired = false;
      let delivered = false;
      const poll = (): void => {
        if (fired) return;
        if (existsSync(target)) {
          fired = true;
          try {
            process.kill(child.pid as number, signal);
            delivered = true;
          } catch { /* the child had already exited; this attempt did not enter the window */ }
          return;
        }
        setImmediate(poll);
      };
      setImmediate(poll);

      child.on('close', (code, sig) => {
        fired = true;
        resolve({ hit: delivered, code, signal: sig, stdout, stderr });
      });
    });
  }

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'reports %s, keeps the published database and cleans up its own temporary',
    async (signal) => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const target = join(dir, 'orchestrator.sqlite');
      const attempt = await interruptDuringPublication(target, signal);

      // The window was genuinely entered: the target existed, so linkSync had returned, and the
      // kernel accepted the signal rather than failing with ESRCH on a dead process.
      expect(attempt.hit, `${signal} was never delivered inside the publication window`).toBe(true);

      // The interrupt is visible in the disposition. Read from the child's own exit fields, not
      // from a shell's 130/143 translation.
      expect(attempt.signal).toBe(signal);
      expect(attempt.code).toBeNull();

      // An interrupted run does not claim an ordinary success, and says what happened.
      expect(attempt.stdout).toBe('');
      expect(attempt.stderr).toBe(`db:init interrupted=${signal}\n`);

      // Its own temporary is gone. The published database is kept: an interrupt is not a rollback.
      expect(readdirSync(dir).filter((n) => n.includes('.dev-orch-init-'))).toEqual([]);
      expect(existsSync(target)).toBe(true);
      expect(lstatSync(target).nlink).toBe(1);

      // The promised repeat run works, and the database really holds v1.
      const again = execFileSync(process.execPath, [CLI, 'db:init', '--db', target], { encoding: 'utf8' });
      expect(again).toContain('result=already_at');
      expect(again).toContain(`checksum=${V1_CHECKSUM}`);
      const db = new Database(target, { readonly: true });
      try {
        expect(db.prepare('SELECT version, checksum FROM schema_migrations').all())
          .toEqual([{ version: 1, checksum: V1_CHECKSUM }]);
        expect(db.prepare('SELECT sql FROM sqlite_master').pluck().get()).toBe(V1_CREATE);
      } finally {
        db.close();
      }
    },
    60_000,
  );

  it('still reports an ordinary success when no signal is sent', () => {
    const target = join(dir, 'orchestrator.sqlite');
    const first = execFileSync(process.execPath, [CLI, 'db:init', '--db', target], { encoding: 'utf8' });
    expect(first).toContain('result=applied');
    expect(first).toContain(`checksum=${V1_CHECKSUM}`);
    expect(readdirSync(dir)).toEqual(['orchestrator.sqlite']);
  });
});
