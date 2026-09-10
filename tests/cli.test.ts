import { describe, it, expect, beforeEach, afterEach, inject } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { assertFreshlyBuilt } from './build-cli.js';
import Database from 'better-sqlite3';
import { V1_CHECKSUM, V1_CREATE } from '../src/db/migrate.js';

// Built by this run into its own directory; never the repository's dist/.
const CLI = assertFreshlyBuilt(inject('cliPath'));
// The importable module, as distinct from the executable above.
const MODULE = assertFreshlyBuilt(inject('cliModulePath'));
// Test-side loader that holds the child inside the publication window.
const REGISTER = fileURLToPath(new URL('./handshake/register.mjs', import.meta.url));

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

// F22. Round 13/16. Without a listener, an ordinary termination signal takes the operating
// system's default action and the process dies without unwinding JavaScript, so the `finally` that
// removes this run's temporary never runs. The target and the temporary are then two names for one
// inode, and every later run refuses with E_DB_TARGET_ALIASED until someone deletes the temporary
// by hand.
//
// Round 16 made this deterministic. Earlier versions polled for the target name and fired when it
// appeared, which proves only that linkSync returned — the target persists after cleanup, so a
// late poll would still "succeed", and an implementation that installed its handlers only after
// the protected work could satisfy every assertion. That is a false green, and it is the exact
// shape being tested for.
//
// Instead a test-side loader redirects `node:fs` inside the child to a shim that wraps linkSync:
// after the real link succeeds and before returning to production code, it writes a ready file and
// then blocks. The parent sends the real signal while the child is held there, and only then
// releases it. A plain `fs.linkSync = ...` patch was measured NOT to work — production uses an ESM
// named import, whose binding does not observe a later property assignment — so the specifier is
// redirected instead. The ready file is also the proof that the shim is genuinely the function
// production calls: if it never appears, the test fails rather than passing quietly.
describe('a real interrupt during publication', () => {
  interface Held {
    engaged: boolean;
    code: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
  }

  function interruptWhileHeld(target: string, signal: string): Promise<Held> {
    return new Promise((resolve, reject) => {
      const ready = join(dir, '.ready');
      const release = join(dir, '.release');
      const child = spawn(
        process.execPath,
        ['--import', REGISTER, CLI, 'db:init', '--db', target],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            A1_HANDSHAKE_READY: ready,
            A1_HANDSHAKE_RELEASE: release,
            A1_HANDSHAKE_LIMIT_MS: '15000',
          },
        },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
      child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

      let engaged = false;
      const deadline = Date.now() + 20_000;
      const waitForHold = (): void => {
        if (existsSync(ready)) {
          engaged = true;
          // The child is provably between the publication link and its cleanup.
          try { process.kill(child.pid as number, signal as NodeJS.Signals); } catch { /* gone */ }
          writeFileSync(release, 'go');
          return;
        }
        if (Date.now() > deadline) {
          // Never reached the hold: fail loudly instead of letting the case pass.
          try { child.kill('SIGKILL'); } catch { /* gone */ }
          reject(new Error('the child never reached the publication hold; the probe did not engage'));
          return;
        }
        setTimeout(waitForHold, 2);
      };
      setTimeout(waitForHold, 2);

      child.on('close', (code, sig) => resolve({ engaged, code, signal: sig, stdout, stderr }));
    });
  }

  it.each(['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const)(
    'reports %s from inside the publication window and cleans up its own temporary',
    async (signal) => {
      const target = join(dir, 'orchestrator.sqlite');
      const held = await interruptWhileHeld(target, signal);

      // The shim ran inside the real publication path, so the window was entered by construction.
      expect(held.engaged, 'the publication hold was never reached').toBe(true);

      // The interrupt is visible in the disposition, read from the child's own exit fields.
      expect(held.signal).toBe(signal);
      expect(held.code).toBeNull();

      // No ordinary success is claimed for an interrupted run, and it says what happened.
      expect(held.stdout).toBe('');
      expect(held.stderr).toBe(`db:init interrupted=${signal}\n`);

      // This run's own temporary is gone; the published database is kept — not rolled back.
      expect(readdirSync(dir).filter((n) => n.includes('.dev-orch-init-'))).toEqual([]);
      expect(existsSync(target)).toBe(true);
      expect(lstatSync(target).nlink).toBe(1);

      // The promised repeat run works and the database really holds v1.
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

// F23. Round 15/16. The module used to call main() at evaluation time, so importing the compiled
// CLI ran the command: it read the host's argv, printed a reason code and set the host's exit
// code, and with a valid --db it created a database in the importing process.
//
// Round 15 tried to fix that by comparing process.argv[1] against this module's resolved path.
// That is not a fact about the module — under `node -e`, argv[1] is just the first positional
// argument, so passing the CLI's own path made the check true and the command ran anyway. The
// Round 15 regression missed it because its argv[1] was the string "db:init", which does not
// resolve, so it exercised the guard's error branch instead of the equal-path branch.
//
// Round 16 stopped guessing: the bootstrap lives in bin.js and index.js is a plain module.
// `import.meta.main` would answer the question directly but is not available across the whole
// supported range (engines: >=22), and the floor is not being raised for it.
//
// The case below is the reviewer's, with argv[1] a REAL resolvable path to the module itself.
describe('importing the compiled CLI', () => {
  it('does nothing when imported, even with argv naming it and a valid db:init', () => {
    const target = join(dir, 'must-not-exist.sqlite');
    const probe = [
      "import { existsSync } from 'node:fs';",
      `const m = await import(${JSON.stringify(MODULE)});`,
      'await new Promise((r) => setTimeout(r, 50));',
      'process.stdout.write(JSON.stringify({',
      "  listeners: ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']",
      '    .reduce((n, s) => n + process.listenerCount(s), 0),',
      '  exitCode: process.exitCode ?? null,',
      `  created: existsSync(${JSON.stringify(target)}),`,
      '  exports: Object.keys(m).sort(),',
      '}));',
    ].join('\n');

    // argv[1] is the module's own resolvable path — the shape that defeated the Round 15 guard —
    // and the remaining arguments are a valid db:init for a database that must not appear.
    const raw = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', probe, MODULE, 'db:init', '--db', target],
      { encoding: 'utf8' },
    );
    const seen = JSON.parse(raw.slice(raw.indexOf('{'))) as {
      listeners: number; exitCode: number | null; created: boolean; exports: string[];
    };

    expect(seen.listeners).toBe(0);
    expect(seen.exitCode).toBeNull();
    expect(seen.created).toBe(false);
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
    // Still importable, and still exporting what the bootstrap needs.
    expect(seen.exports).toEqual(['main', 'run']);
  });

  it('still runs when started as a program through a symlink, as the installed bin is', () => {
    const link = join(dir, 'dev-orch');
    symlinkSync(CLI, link);
    const target = join(dir, 'via-symlink.sqlite');
    const first = execFileSync(process.execPath, [link, 'db:init', '--db', target], { encoding: 'utf8' });
    expect(first).toContain('result=applied');
    const second = execFileSync(process.execPath, [link, 'db:init', '--db', target], { encoding: 'utf8' });
    expect(second).toContain('result=already_at');
  });
});
