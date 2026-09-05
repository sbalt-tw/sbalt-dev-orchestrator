#!/usr/bin/env node
// A1 command line: dev-orch db:init --db <absolute-path>
//
// --db is required, must be absolute, and is never inferred from the working directory,
// the environment or a built-in default. Missing parent directories are not created.

import { InitError, initialise } from '../db/migrate.js';

const USAGE = 'usage: dev-orch db:init --db <absolute-path>';

function fail(code: string, message: string): number {
  process.stderr.write(`db:init error=${code} ${message}\n`);
  return 1;
}

function parseDbFlag(args: readonly string[]): string {
  let value: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--db') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new InitError('E_DB_ARG_MISSING', '--db requires a value');
      }
      value = next;
      i += 1;
    } else if (arg !== undefined && arg.startsWith('--db=')) {
      value = arg.slice('--db='.length);
    } else {
      throw new InitError('E_DB_ARG_MISSING', `unexpected argument "${String(arg)}"`);
    }
  }
  if (value === undefined || value === '') {
    throw new InitError('E_DB_ARG_MISSING', '--db is required');
  }
  return value;
}

export function run(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  if (command !== 'db:init') {
    return fail('E_DB_ARG_MISSING', USAGE);
  }
  try {
    const outcome = initialise(parseDbFlag(rest));
    process.stdout.write(
      `db:init result=${outcome.status} version=${outcome.version} checksum=${outcome.checksum}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof InitError) return fail(error.code, error.message);
    throw error;
  }
}

process.exitCode = run(process.argv.slice(2));
