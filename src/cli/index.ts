#!/usr/bin/env node
// A1 command line: dev-orch db:init --db <absolute-path>
//
// --db is required, must be absolute, and is never inferred from the working directory,
// the environment or a built-in default. Missing parent directories are not created. The
// command accepts no SQL, no migration path, no registry and no fault-injection parameter.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { InitError, REASON_TEXT, initialise } from '../db/migrate.js';
import type { ReasonCode } from '../db/migrate.js';

/**
 * Every failure leaves through here, so the only bytes on stderr are a fixed reason code
 * and its fixed text. Arguments, driver messages, native stacks, journal details and
 * database values are never echoed, including for an error this command did not anticipate.
 */
function fail(code: ReasonCode): number {
  process.stderr.write(`db:init error=${code} ${REASON_TEXT[code]}\n`);
  return 1;
}

/**
 * Every rejection here happens before any database operation, so an ambiguous command line
 * never creates anything. A repeated --db used to overwrite the previous value silently, so
 * `--db /a --db /b` initialised /b, and `--db= --db=/b` even slipped past the empty-value
 * refusal because the later value replaced the empty one before it was checked.
 */
function parseDbFlag(args: readonly string[]): string {
  let value: string | undefined;
  const claim = (next: string | undefined): void => {
    if (value !== undefined) throw new InitError('E_DB_ARG_REPEATED');
    if (next === undefined || next === '' || next.startsWith('--')) {
      throw new InitError('E_DB_ARG_MISSING');
    }
    value = next;
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--db') {
      claim(args[i + 1]);
      i += 1;
    } else if (arg !== undefined && arg.startsWith('--db=')) {
      claim(arg.slice('--db='.length));
    } else {
      throw new InitError('E_DB_ARG_MISSING');
    }
  }
  if (value === undefined) throw new InitError('E_DB_ARG_MISSING');
  return value;
}

// SIGHUP is here for the same reason as the other two, not as an extra nicety: it is catchable
// but terminates by default, so before this it took the operating system's default action and
// stranded the temporary exactly as SIGINT and SIGTERM did — measured at 5 of 5 runs, with every
// following run then refused as E_DB_TARGET_ALIASED. Closing a terminal or restarting a service
// sends it. The accepted limitations name only the uncatchable SIGKILL, so leaving SIGHUP out
// would have kept that boundary quietly wider than it is written.
const INTERRUPT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
type InterruptSignal = (typeof INTERRUPT_SIGNALS)[number];

type Executed =
  | { readonly ok: true; readonly outcome: ReturnType<typeof initialise> }
  | { readonly ok: false; readonly code: ReasonCode };

/** Does the work and decides the outcome. Writes nothing: reporting is a separate step. */
function execute(argv: readonly string[]): Executed {
  const [command, ...rest] = argv;
  if (command !== 'db:init') return { ok: false, code: 'E_DB_ARG_MISSING' };
  try {
    return { ok: true, outcome: initialise(parseDbFlag(rest)) };
  } catch (error) {
    return { ok: false, code: error instanceof InitError ? error.code : 'E_INTERNAL' };
  }
}

function report(result: Executed): number {
  if (!result.ok) return fail(result.code);
  const { status, version, checksum } = result.outcome;
  process.stdout.write(`db:init result=${status} version=${version} checksum=${checksum}\n`);
  return 0;
}

export function run(argv: readonly string[]): number {
  return report(execute(argv));
}

/**
 * Installs interrupt handling for the duration of one command, and only here.
 *
 * Round 13: with no listener attached, SIGINT and SIGTERM take their default action and the
 * process is terminated by the operating system without unwinding JavaScript — so the `finally`
 * that removes this run's temporary name never executed. A signal arriving between the
 * publication link and that cleanup left the target and the temporary as two names for one
 * inode, and every later run then refused with E_DB_TARGET_ALIASED until an operator found and
 * removed the temporary by hand. Ctrl-C and an ordinary service stop are not the uncatchable
 * SIGKILL the accepted limitations cover, so this had quietly widened that waiver.
 *
 * Attaching a listener is the whole mechanism: it defers the default termination, the pending
 * synchronous work — including the cleanup in initialise's `finally` — runs to completion, and
 * only then is the signal acted on. The handler records which signal arrived and does nothing
 * else. It performs no cleanup of its own, so it cannot re-enter cleanup, cannot race it, and
 * cannot remove a published target, another program's file, or a real SQLite sidecar: removal
 * stays exactly where it was, on the temporary name this run created and holds. A cleanup
 * failure is still reported as E_TEMPORARY_NOT_REMOVED rather than hidden by the interruption.
 *
 * Round 14 corrected the second half. Keeping the listeners only for the duration of the
 * synchronous work preserved the cleanup but *discarded the signal*: libuv reads its signal pipe
 * in the loop's poll phase, so a signal that arrived during db:init cannot reach JavaScript until
 * control returns to the loop. Removing the listeners the instant the work returned meant the
 * handler never ran, `interrupted` stayed null, and the command printed an ordinary success for a
 * run the operator had interrupted. So the listeners now stay installed across a deliberate pass
 * through the loop, and nothing is reported until that pass is done:
 *
 *   1. do the work synchronously, writing nothing;
 *   2. yield through a timer, which forces a full iteration — timers, then poll, where a pending
 *      signal is read and its handler queued;
 *   3. yield again through an immediate, so a handler queued during that iteration has run
 *      before anything is decided;
 *   4. only then report, and only then remove the listeners.
 *
 * Verified on the Node this package supports (>=22): with this ordering a signal delivered during
 * the synchronous section is normally observed, whereas the Round 13 ordering lost it.
 *
 * WHAT THIS DOES NOT ACHIEVE, accepted rather than fixed. It does not guarantee that every signal
 * the operating system has delivered is reflected in the output or in the exit. A signal can be
 * delivered *before* the decision and still have its JavaScript handler dispatched *after* it —
 * which is not the same as "the signal arrived after the work finished", and is the case that
 * remains open. When that happens the command reports the result it genuinely completed and exits
 * normally, and the signal disposition is not guaranteed to match what was sent. More timers or
 * yields would only move the sampling point rather than remove it; closing it needs a lifecycle
 * with an explicit completion boundary, which this tool has deliberately not adopted. Recorded as
 * OPEN/ACCEPTED, not as fixed.
 *
 * What is *not* accepted, and is enforced: an interrupt that was observed is never ignored; no
 * success is reported for an operation that did not complete; a primary error or a cleanup failure
 * is never hidden behind a success; and none of SIGINT, SIGTERM or SIGHUP may strand the temporary
 * and wedge the path — covered by the listeners above and by real-signal regressions.
 *
 * An observed interrupt therefore prints no applied/already_at line, and the same signal is
 * re-raised after the listeners are removed, so the exit carries the disposition that was sent.
 * A failure that happened before the interrupt still prints its own reason code: the interruption
 * never hides a cleanup failure or overwrites a primary error.
 *
 * A database that was already published stays published. An interrupt is not a rollback, and
 * nothing here removes a target to make the exit look tidier.
 *
 * This is deliberately not a recovery feature: nothing scans for or deletes leftovers from an
 * earlier run, and nothing is promised for terminations this cannot observe — SIGKILL and power
 * loss remain exactly as accepted before.
 */
async function main(): Promise<void> {
  let interrupted: InterruptSignal | null = null;
  const installed = INTERRUPT_SIGNALS.map((signal) => {
    // The first signal wins; a repeated Ctrl-C changes nothing and starts no second teardown.
    const handler = (): void => {
      if (interrupted === null) interrupted = signal;
    };
    process.on(signal, handler);
    return { signal, handler };
  });
  const uninstall = (): void => {
    for (const { signal, handler } of installed) process.removeListener(signal, handler);
  };

  const result = execute(process.argv.slice(2));

  // Give a signal that arrived during the synchronous work above its chance to be dispatched.
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  await new Promise<void>((resolve) => { setImmediate(resolve); });

  if (interrupted !== null) {
    // A primary failure keeps its own reason code; the interruption is reported alongside it.
    if (!result.ok) fail(result.code);
    process.stderr.write(`db:init interrupted=${interrupted}\n`);
    uninstall();
    process.kill(process.pid, interrupted);
    return;
  }

  const code = report(result);
  uninstall();
  process.exitCode = code;
}

/**
 * True only when this module is the program Node was told to run.
 *
 * Round 15: `main()` used to be invoked unconditionally at module evaluation, so importing the
 * compiled CLI *ran the command* — it read the host's argv, printed `E_DB_ARG_MISSING`, and set
 * the host's exit code. With a valid `--db` in the host's argv it would have created a database.
 * The claim that importing installed nothing was simply false.
 *
 * argv[1] is resolved through realpath before comparing, because the installed `dev-orch` is a
 * symlink in node_modules/.bin: comparing the link path against this module's real URL would
 * make the real bin stop running. A missing or unresolvable argv[1] means this was not started
 * as a program, so the command does not run.
 */
function startedAsProgram(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (startedAsProgram()) void main();
