// A1 command line: dev-orch db:init --db <absolute-path>
//
// --db is required, must be absolute, and is never inferred from the working directory,
// the environment or a built-in default. Missing parent directories are not created. The
// command accepts no SQL, no migration path, no registry and no fault-injection parameter.

import { constants } from 'node:os';
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

// The ordinary "please stop" signals. Each is catchable and terminates by default, so without a
// listener each took the operating system's default action and stranded this run's temporary —
// measured, through a deterministic handshake that holds the child between the publication link
// and its cleanup, with every following run then refused as E_DB_TARGET_ALIASED.
//
// Chosen from a measured inventory of this runtime rather than one at a time. Deliberately NOT
// included: signals the runtime reserves or ignores (SIGUSR1 is Node's debugger signal; SIGPIPE,
// SIGWINCH, SIGCHLD, SIGURG, SIGCONT, SIGIO, SIGTSTP and SIGXFSZ do not terminate by default);
// signals that cannot be caught (SIGKILL, SIGSTOP); and the fault signals (SIGSEGV, SIGBUS,
// SIGILL, SIGFPE, SIGABRT, SIGTRAP, SIGSYS), where the process state is not one in which running
// JavaScript cleanup can be claimed to be safe.
//
// Outside this list, and accepted rather than silently dropped: SIGUSR2, SIGALRM, SIGVTALRM,
// SIGPROF and SIGXCPU also terminate by default, and each was measured to strand the temporary
// through the same handshake. Any process able to signal this one can send them directly — they
// are not conditional on this process enabling a timer or a profiler. They are nonetheless not
// termination requests, and intercepting them would change behaviour that is not this tool's to
// change, so the cleanup guarantee is this explicit list of four and no more. The rest is an
// accepted limitation, recorded in the README, not a claim of coverage.
const INTERRUPT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const;
type InterruptSignal = (typeof INTERRUPT_SIGNALS)[number];

// The conventional shell disposition for "terminated by this signal", taken from the runtime's own
// table rather than written out here, so the numbers are this platform's and not a guess.
const SIGNAL_EXIT: Record<InterruptSignal, number> = {
  SIGINT: 128 + constants.signals.SIGINT,
  SIGTERM: 128 + constants.signals.SIGTERM,
  SIGHUP: 128 + constants.signals.SIGHUP,
  SIGQUIT: 128 + constants.signals.SIGQUIT,
};

// How long an interrupted run waits for its own diagnostics to reach a backpressured stderr before
// terminating anyway. Long enough for a slow reader, short enough that a reader which never reads
// cannot hold an interrupted command open.
const DIAGNOSTIC_FLUSH_LIMIT_MS = 2_000;

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
 * Keeps a failed output stream inside the fixed diagnostic boundary above.
 *
 * Round 18: reporting wrote to stdout without handling that stream's asynchronous `error` event.
 * A consumer that goes away before the line is written — `dev-orch db:init … | head -1`, a reader
 * that was killed — made the write emit EPIPE with no listener, which Node raises as an uncaught
 * exception: a native stack, internal frames and the absolute path of the installation, printed
 * straight past `fail`, for an operation that had already completed successfully. Reproduced by
 * destroying the child's stdout while it classified a valid v1 database.
 *
 * There is nothing to report through a sink that has gone away, and stderr may be the same broken
 * pipe, so nothing further is written: the failure is absorbed and the exit becomes a fixed 1.
 * Silence here is not hiding an error — the operation's own outcome is unchanged and, for the
 * write that failed, the operator's own end of the pipe is what closed. A non-zero exit is still
 * the honest answer, because the result line did not reach them.
 *
 * Installed by `main` only. `run` is the pure entry point and stays free of process-level effects.
 */
function absorbOutputStreamFailures(): void {
  for (const stream of [process.stdout, process.stderr]) {
    // Round 19: adding to a shared emitter that an embedder has already filled to its ceiling made
    // Node print MaxListenersExceededWarning — process id and all, and under --trace-warnings a
    // native stack and this file's absolute path — which is exactly the diagnostic leak `fail`
    // exists to prevent, arriving before any database work. Raising the ceiling by the one
    // listener being added keeps that quiet without hiding a real accumulation elsewhere.
    stream.setMaxListeners(stream.getMaxListeners() + 1);
    stream.on('error', () => {
      process.exitCode = 1;
    });
  }
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
 * is never hidden behind a success; and none of the four handled signals — SIGINT, SIGTERM, SIGHUP
 * or SIGQUIT — may strand the temporary and wedge the path, which the listeners above and the
 * real-signal regressions cover. Termination by anything else is the separate accepted limitation
 * recorded in the README, and is not claimed here.
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
export async function main(): Promise<void> {
  absorbOutputStreamFailures();
  let interrupted: InterruptSignal | null = null;
  // Signal registration has the same ceiling, and the same consequence if an embedder is at it.
  process.setMaxListeners(process.getMaxListeners() + 1);
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

    // Round 19: neither of the two ways this ends waits for stderr. Termination by signal is
    // immediate, and process.exit does not flush an asynchronous stdio pipe — so against a
    // backpressured stderr the diagnostics were simply discarded: measured exit 143 with neither
    // the reason code nor the interrupt line emitted, which would hide a cleanup failure on the
    // one path that most needs to report it. Writes are ordered, so waiting on this one waits for
    // the reason code ahead of it too. The wait is bounded because a reader that never reads
    // cannot be made to, and no listener is attached here: an unwritable stderr must stay
    // observable to the handler installed above, not be quietly absorbed by this wait.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, DIAGNOSTIC_FLUSH_LIMIT_MS);
      timer.unref();
      process.stderr.write(`db:init interrupted=${interrupted}\n`, () => { clearTimeout(timer); resolve(); });
    });
    uninstall();

    // Re-raising is how the exit normally carries the disposition that was sent: with this
    // command's listeners gone, the default action terminates the process here and the exit
    // reports the signal itself.
    //
    // Round 18: taking that for granted was wrong whenever *another* listener for the same signal
    // is still attached — a preloaded module, an embedder, a supervisor's shim. Then the default
    // action does not apply, `kill` simply returns, and this fell through to an ordinary exit 0:
    // success reported for a run the operator had interrupted. Reproduced with nothing more exotic
    // than a preloaded no-op SIGTERM listener, and SIGTERM is one of the four signals whose
    // handling is guaranteed, so neither accepted limitation covered it. A foreign listener holding
    // an open handle could also have left the command running instead of exiting at all.
    //
    // So the disposition is decided here rather than inferred from whether the default action
    // happened to fire. The exit code is set before re-raising, which is what the process would
    // fall back to anyway, and the explicit exit below is reached only when something else
    // suppressed the signal.
    process.exitCode = SIGNAL_EXIT[interrupted];
    process.kill(process.pid, interrupted);
    process.exit(SIGNAL_EXIT[interrupted]);
  }

  const code = report(result);
  uninstall();
  process.exitCode = code;
}


