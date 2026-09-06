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

export function run(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  if (command !== 'db:init') return fail('E_DB_ARG_MISSING');
  try {
    const outcome = initialise(parseDbFlag(rest));
    process.stdout.write(
      `db:init result=${outcome.status} version=${outcome.version} checksum=${outcome.checksum}\n`,
    );
    return 0;
  } catch (error) {
    return fail(error instanceof InitError ? error.code : 'E_INTERNAL');
  }
}

process.exitCode = run(process.argv.slice(2));
