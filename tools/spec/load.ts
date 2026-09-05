// Loads the specification bundle from a repository root. Reads only specification
// files, configuration text and anything under src/; it never imports runtime code.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SpecBundle, SourceFile } from './types.js';

export function repoRoot(): string {
  // tools/spec/load.ts -> tools/spec -> tools -> <root>
  const here = fileURLToPath(new URL('.', import.meta.url));
  return join(here, '..', '..');
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readTextIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function walk(dir: string, root: string, out: SourceFile[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, root, out);
    } else {
      out.push({ path: relative(root, full).split(sep).join('/'), content: readFileSync(full, 'utf8') });
    }
  }
}

const DOC_FILES = [
  'README.md',
  '00-model.md',
  '01-invariants.md',
  '02-envelope.md',
  '03-evidence.md',
  '04-journal.md',
  '05-leases.md',
  '06-review.md',
  '07-identity.md',
  '08-slices.md',
  '09-decisions.md',
  '10-gates.md',
  '11-pr1-disposition.md',
  '12-errata.md',
  '13-test-triage.md',
  '14-findings.md',
];

export function loadBundle(root: string = repoRoot()): SpecBundle {
  const m = (name: string) => join(root, 'spec', 'manifests', name);

  const docs: Record<string, string> = {};
  for (const file of DOC_FILES) {
    docs[file] = readTextIfPresent(join(root, 'spec', file));
  }

  const runtimeFiles: SourceFile[] = [];
  const srcDir = join(root, 'src');
  if (existsSync(srcDir)) walk(srcDir, root, runtimeFiles);

  return {
    root,
    invariants: readJson(m('invariants.json')),
    actionMatrix: readJson(m('action-matrix.json')),
    slices: readJson(m('slices.json')),
    triage: readJson(m('test-triage.json')),
    findings: readJson(m('findings.json')),
    decisions: readJson(m('decisions.json')),
    gates: readJson(m('gates.json')),
    docs,
    runtimeFiles,
    configs: {
      'tsconfig.build.json': readTextIfPresent(join(root, 'tsconfig.build.json')),
      'package.json': readTextIfPresent(join(root, 'package.json')),
      'tests/spec/validator-negative.test.ts': readTextIfPresent(
        join(root, 'tests', 'spec', 'validator-negative.test.ts'),
      ),
    },
  };
}

export { DOC_FILES };
