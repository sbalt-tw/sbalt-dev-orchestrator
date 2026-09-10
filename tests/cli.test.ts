import { describe, it, expect, beforeEach, afterEach, inject } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
// The repository root, so the manifest is read from where npm would read it.
const REPO = fileURLToPath(new URL('..', import.meta.url));
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

// F22. Round 13/16/18. Without a listener, an ordinary termination signal takes the operating
// system's default action and the process dies without unwinding JavaScript, so the `finally` that
// removes this run's temporary never runs. The target and the temporary are then two names for one
// inode, and every later run refuses with E_DB_TARGET_ALIASED until someone deletes the temporary.
//
// The window is entered deterministically, not raced. A test-side loader redirects `node:fs`
// inside the child to a shim wrapping linkSync: after the real link succeeds and before returning
// to production code it announces readiness and waits. A plain `fs.linkSync = ...` patch was
// measured NOT to work — production uses an ESM named import, whose binding does not observe a
// later property assignment — so the specifier is redirected instead.
//
// Round 18 fixed how that hold is proved. Previously the child spun on Date.now() and, on expiry,
// simply returned; the parent inferred "still held" from the ready file, which persists after
// cleanup. A stalled parent could therefore signal after the hold had lapsed and after cleanup had
// completed, and still be recorded as having hit the window — the same false green this test
// exists to prevent. Now:
//
//   * the child's deadline is monotonic, so a wall-clock jump cannot change it;
//   * on expiry the child writes an `expired` marker and never writes `released`;
//   * on release the child writes `released` BEFORE linkSync returns.
//
// The parent requires the `released` marker and the absence of `expired`. It does not accept the
// ready file as proof of anything but arrival. Deliberately, the child does not throw on expiry:
// production would catch that, clean up, and report an ordinary failure that the test could
// mistake for a legitimate refusal. The markers keep the judgement on the test side.
describe('a real interrupt during publication', () => {
  interface Held {
    ready: boolean;
    released: boolean;
    expired: boolean;
    code: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
  }

  interface HoldOptions {
    /** Milliseconds the child will hold before giving up. */
    limitMs?: number;
    /** Called once the child is holding; decides when (or whether) to release. */
    onHold?: (release: () => void) => void | Promise<void>;
    /** Moves the child's Date.now, to show the hold's deadline does not depend on it. */
    skewMs?: number;
  }

  function interruptWhileHeld(
    target: string,
    signal: string | null,
    options: HoldOptions = {},
  ): Promise<Held> {
    return new Promise((resolve, reject) => {
      // A fresh identity per attempt, so a marker from an earlier case can never be mistaken
      // for this one's evidence.
      const id = randomUUID();
      const ready = join(dir, `.ready-${id}`);
      const releaseFlag = join(dir, `.release-${id}`);
      const released = join(dir, `.released-${id}`);
      const expired = join(dir, `.expired-${id}`);

      const child = spawn(
        process.execPath,
        ['--import', REGISTER, CLI, 'db:init', '--db', target],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            A1_HANDSHAKE_READY: ready,
            A1_HANDSHAKE_RELEASE: releaseFlag,
            A1_HANDSHAKE_RELEASED: released,
            A1_HANDSHAKE_EXPIRED: expired,
            A1_HANDSHAKE_LIMIT_MS: String(options.limitMs ?? 15_000),
            A1_HANDSHAKE_SKEW_MS: String(options.skewMs ?? 0),
          },
        },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
      child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

      let sawReady = false;
      const deadline = Date.now() + 30_000;
      const poll = async (): Promise<void> => {
        if (existsSync(ready)) {
          sawReady = true;
          const doRelease = (): void => { writeFileSync(releaseFlag, 'go'); };
          if (signal !== null) {
            try { process.kill(child.pid as number, signal as NodeJS.Signals); } catch { /* gone */ }
          }
          if (options.onHold) await options.onHold(doRelease);
          else doRelease();
          return;
        }
        if (Date.now() > deadline) {
          try { child.kill('SIGKILL'); } catch { /* gone */ }
          reject(new Error('the child never announced the publication hold'));
          return;
        }
        setTimeout(() => { void poll(); }, 2);
      };
      setTimeout(() => { void poll(); }, 2);

      child.on('close', (code, sig) => resolve({
        ready: sawReady,
        released: existsSync(released),
        expired: existsSync(expired),
        code,
        signal: sig,
        stdout,
        stderr,
      }));
    });
  }

  /** The handshake held and was released from inside linkSync — the only accepted proof. */
  function expectHeldThroughout(held: Held): void {
    expect(held.ready, 'the child never announced the hold').toBe(true);
    expect(held.expired, 'the hold expired: the signal did not land inside the window').toBe(false);
    expect(held.released, 'the child never observed the release before linkSync returned').toBe(true);
  }

  it.each(['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const)(
    'reports %s from inside the publication window and cleans up its own temporary',
    async (signal) => {
      const target = join(dir, 'orchestrator.sqlite');
      const held = await interruptWhileHeld(target, signal);
      expectHeldThroughout(held);

      expect(held.signal).toBe(signal);
      expect(held.code).toBeNull();
      expect(held.stdout).toBe('');
      expect(held.stderr).toBe(`db:init interrupted=${signal}\n`);

      expect(readdirSync(dir).filter((n) => n.includes('.dev-orch-init-'))).toEqual([]);
      expect(existsSync(target)).toBe(true);
      expect(lstatSync(target).nlink).toBe(1);

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

  // The handshake's own failure modes. If these did not fail, the cases above could pass without
  // ever entering the window — which is exactly how the previous version could go false green.
  describe('the handshake itself fails when the hold does not hold', () => {
    it('records expiry, and no release, when the parent never releases', async () => {
      const held = await interruptWhileHeld(join(dir, 'orchestrator.sqlite'), null, {
        limitMs: 150,
        onHold: async () => { await new Promise((r) => { setTimeout(r, 400); }); },
      });
      expect(held.ready).toBe(true);
      expect(held.expired, 'expiry must be recorded, not silent').toBe(true);
      expect(held.released, 'a lapsed hold must not count as released').toBe(false);
      // And the guard the real cases use rejects it.
      expect(() => expectHeldThroughout(held)).toThrow();
    }, 60_000);

    it('does not backdate a release that arrives after the hold lapsed', async () => {
      const held = await interruptWhileHeld(join(dir, 'orchestrator.sqlite'), null, {
        limitMs: 100,
        onHold: async (release) => {
          await new Promise((r) => { setTimeout(r, 400); });
          release();
        },
      });
      expect(held.expired).toBe(true);
      expect(held.released, 'a late release must not be credited').toBe(false);
      expect(() => expectHeldThroughout(held)).toThrow();
    }, 60_000);

    // The deadline is monotonic, so moving the wall clock cannot end or extend the hold. Date.now
    // is replaced in the CHILD, which is where the deadline is measured.
    it.each([
      ['forward', 3_600_000],
      ['backward', -3_600_000],
    ])('is unaffected by a %s wall-clock jump inside the child', async (_label, skewMs) => {
      const target = join(dir, 'orchestrator.sqlite');
      const held = await interruptWhileHeld(target, 'SIGTERM', {
        limitMs: 15_000,
        onHold: (release) => { release(); },
        skewMs,
      });
      expectHeldThroughout(held);
      expect(held.signal).toBe('SIGTERM');
    }, 60_000);
  });

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
// F24. Round 18. The bootstrap split moved the executable, and `scripts.dev-orch` was left
// pointing at the module that had just been made inert — so `npm run dev-orch -- db:init …`
// exited 0, printed nothing and created no database, reporting success for work it never did.
// Neither the suite nor the workflow noticed, because both invoked a hard-coded bin path.
//
// These cases therefore start from what the manifest declares, not from a path this file chose:
// the script as a user would run it, and the `bin` entry as a consumer would resolve it. A future
// rename that updates only some of the declarations fails here.
describe('the launchers the manifest declares', () => {
  const manifest = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
    bin: Record<string, string>;
  };
  const lockRoot = (JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { bin?: Record<string, string> }>;
  }).packages[''] ?? { bin: undefined };

  it('runs the command through `npm run dev-orch`, as a user would', () => {
    const target = join(dir, 'via-script.sqlite');
    const first = execFileSync('npm', ['run', '--silent', 'dev-orch', '--', 'db:init', '--db', target],
      { cwd: REPO, encoding: 'utf8' });
    expect(first).toContain('result=applied');
    expect(first).toContain(`checksum=${V1_CHECKSUM}`);
    expect(existsSync(target)).toBe(true);

    const second = execFileSync('npm', ['run', '--silent', 'dev-orch', '--', 'db:init', '--db', target],
      { cwd: REPO, encoding: 'utf8' });
    expect(second).toContain('result=already_at');
    expect(second).toContain(`checksum=${V1_CHECKSUM}`);

    const db = new Database(target, { readonly: true });
    try {
      expect(db.prepare('SELECT version, checksum FROM schema_migrations').all())
        .toEqual([{ version: 1, checksum: V1_CHECKSUM }]);
      expect(db.prepare('SELECT sql FROM sqlite_master').pluck().get()).toBe(V1_CREATE);
    } finally {
      db.close();
    }
  }, 120_000);

  // npm records the lockfile's copy without the leading "./", so the comparison normalises that
  // one difference and nothing else: a genuinely different target still fails here.
  it('declares the same bin target in package.json and the lockfile root', () => {
    const normalise = (m: Record<string, string> | undefined): Record<string, string> =>
      Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, v.replace(/^\.\//, '')]));
    expect(normalise(lockRoot.bin)).toEqual(normalise(manifest.bin));
  });

  // The script and the bin entry name different files -- one TypeScript source, one compiled --
  // but both must be the bootstrap, never the module that does nothing when loaded.
  it('points every declared launcher at the bootstrap, not the inert module', () => {
    expect(manifest.scripts['dev-orch']).toContain('src/cli/bin.ts');
    expect(manifest.bin['dev-orch']).toContain('dist/cli/bin.js');
    expect(manifest.scripts['dev-orch']).not.toContain('src/cli/index.ts');
    expect(manifest.bin['dev-orch']).not.toContain('dist/cli/index.js');
  });
});

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
