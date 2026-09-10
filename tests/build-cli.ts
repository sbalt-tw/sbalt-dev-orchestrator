// Compiles the CLI freshly for each test run into a directory belonging to that run.
//
// The suite used to spawn the repository's own `dist/cli/index.js`, so `vitest run` failed
// unless a build had happened first and could silently have exercised a stale artifact.
// Nothing here reads `dist/`, and the path reaches the workers through Vitest's
// provide/inject channel, which forked workers do not reliably inherit from the environment.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GlobalSetupContext } from 'vitest/node';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIST = join(REPO, 'dist');

declare module 'vitest' {
  export interface ProvidedContext { cliPath: string; cliModulePath: string }
}

/** Rejects anything under the repository's own dist/, so a stale artifact cannot be used. */
export function assertFreshlyBuilt(cli: string): string {
  if (!cli) throw new Error('the global build step did not provide a CLI path');
  if (cli.startsWith(REPO_DIST)) throw new Error('the test CLI must not come from the repository dist/');
  return cli;
}

export default function setup({ provide }: GlobalSetupContext): () => void {
  // Unique to this run, and inside node_modules rather than the system temp directory: the
  // compiled CLI imports better-sqlite3, which Node resolves by walking up from the file's
  // own location. node_modules is git-ignored, so nothing here can be committed by accident.
  const out = mkdtempSync(join(REPO, 'node_modules', '.a1-build-'));
  try {
    execFileSync(
      process.execPath,
      [join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json', '--outDir', out],
      { cwd: REPO, stdio: 'inherit' },
    );
    // The executable is bin.js, not index.js: Round 16 split the bootstrap out so that the
    // module can be imported without running the command.
    provide('cliPath', assertFreshlyBuilt(join(out, 'cli', 'bin.js')));
    provide('cliModulePath', assertFreshlyBuilt(join(out, 'cli', 'index.js')));
  } catch (error) {
    // A failed build must not leave its directory behind for a later run to find.
    rmSync(out, { recursive: true, force: true });
    throw error;
  }
  return () => rmSync(out, { recursive: true, force: true });
}
