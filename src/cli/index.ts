#!/usr/bin/env node
// A1 command line: dev-orch db:init --db <absolute-path>
//
// --db is required, must be absolute, and is never inferred from the working directory,
// the environment or a built-in default. Missing parent directories are not created. The
// command accepts no SQL, no migration path, no registry and no fault-injection parameter.

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

const INTERRUPT_SIGNALS = ['SIGINT', 'SIGTERM'] as const;
type InterruptSignal = (typeof INTERRUPT_SIGNALS)[number];

export function run(
  argv: readonly string[],
  interruptedBy: () => InterruptSignal | null = () => null,
): number {
  const [command, ...rest] = argv;
  if (command !== 'db:init') return fail('E_DB_ARG_MISSING');
  try {
    const outcome = initialise(parseDbFlag(rest));
    // initialise is synchronous, so a signal that arrived while it ran is delivered only now,
    // after its own cleanup has finished. Reporting success here would claim a completed run
    // that the operator interrupted, so the interruption is reported instead.
    const signal = interruptedBy();
    if (signal !== null) {
      process.stderr.write(`db:init interrupted=${signal}\n`);
      return 1;
    }
    process.stdout.write(
      `db:init result=${outcome.status} version=${outcome.version} checksum=${outcome.checksum}\n`,
    );
    return 0;
  } catch (error) {
    // A failure keeps its own reason code even if a signal also arrived. The publication state
    // it describes is what happened; the interruption is carried by the exit disposition below.
    return fail(error instanceof InitError ? error.code : 'E_INTERNAL');
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
 * If the signal is dispatched before the command finishes it is not swallowed: the listeners are
 * removed and the same signal is re-raised, so the process exits with the disposition the
 * operator sent rather than lingering or reporting an ordinary status.
 *
 * Measured, so this says no more than it does: db:init is one synchronous block, and Node
 * dispatches a signal to JavaScript only between event-loop turns. A signal sent during a typical
 * run is therefore usually never dispatched at all — the command completes first, exits 0, and
 * there is nothing left to interrupt. What the listener changes is the part that mattered: the
 * operating system no longer terminates the process mid-run, so the cleanup in initialise's
 * `finally` always executes. Against this same window, ten of ten runs stranded a temporary and
 * wedged the next invocation without the listener, and ten of ten were clean with it.
 *
 * This is deliberately not a recovery feature: nothing scans for or deletes leftovers from an
 * earlier run, and nothing is promised for terminations this cannot observe — SIGKILL and power
 * loss remain exactly as accepted before.
 */
function main(): void {
  let interrupted: InterruptSignal | null = null;
  const installed = INTERRUPT_SIGNALS.map((signal) => {
    // The first signal wins; a repeated Ctrl-C changes nothing and starts no second teardown.
    const handler = (): void => {
      if (interrupted === null) interrupted = signal;
    };
    process.on(signal, handler);
    return { signal, handler };
  });

  let code: number;
  try {
    code = run(process.argv.slice(2), () => interrupted);
  } finally {
    for (const { signal, handler } of installed) process.removeListener(signal, handler);
  }

  if (interrupted !== null) {
    process.kill(process.pid, interrupted);
    return;
  }
  process.exitCode = code;
}

main();
