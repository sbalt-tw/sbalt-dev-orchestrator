// Loads the specification bundle from a repository root.
//
// Loading is fail-closed: a required document or manifest that is missing, empty or
// malformed becomes a coded problem carried on the bundle, never an empty string and never
// an uncoded exception. Round-1 MEDIUM 19 was exactly that hole.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SpecBundle, SourceFile, LoadProblem } from './types.js';
import { REQUIRED_DOCS, REQUIRED_MANIFESTS } from './anchors.js';

export function repoRoot(): string {
  // tools/spec/load.ts -> tools/spec -> tools -> <root>
  const here = fileURLToPath(new URL('.', import.meta.url));
  return join(here, '..', '..');
}

function readRequiredText(path: string, label: string, problems: LoadProblem[]): string {
  if (!existsSync(path)) {
    problems.push({ code: 'DOC_MISSING', detail: `${label} does not exist` });
    return '';
  }
  const text = readFileSync(path, 'utf8');
  if (text.trim().length === 0) {
    problems.push({ code: 'DOC_EMPTY', detail: `${label} is empty` });
  }
  return text;
}

function readRequiredJson<T>(path: string, label: string, problems: LoadProblem[]): T | null {
  if (!existsSync(path)) {
    problems.push({ code: 'MANIFEST_MISSING', detail: `${label} does not exist` });
    return null;
  }
  const raw = readFileSync(path, 'utf8');
  if (raw.trim().length === 0) {
    problems.push({ code: 'MANIFEST_MALFORMED', detail: `${label} is empty` });
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      problems.push({ code: 'MANIFEST_MALFORMED', detail: `${label} is not a JSON object` });
      return null;
    }
    return parsed as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    problems.push({ code: 'MANIFEST_MALFORMED', detail: `${label} does not parse: ${message}` });
    return null;
  }
}

function readOptionalText(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function walk(dir: string, root: string, out: SourceFile[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, root, out);
    } else {
      out.push({
        path: relative(root, full).split(sep).join('/'),
        content: readFileSync(full, 'utf8'),
      });
    }
  }
}

export function loadBundle(root: string = repoRoot()): SpecBundle {
  const problems: LoadProblem[] = [];
  const manifestPath = (name: string) => join(root, 'spec', 'manifests', name);

  const docs: Record<string, string> = {};
  for (const file of REQUIRED_DOCS) {
    docs[file] = readRequiredText(join(root, 'spec', file), `spec/${file}`, problems);
  }

  const manifests: Record<string, unknown> = {};
  for (const name of REQUIRED_MANIFESTS) {
    const value = readRequiredJson<unknown>(manifestPath(name), `spec/manifests/${name}`, problems);
    if (value !== null) manifests[name] = value;
  }

  const runtimeFiles: SourceFile[] = [];
  const srcDir = join(root, 'src');
  if (existsSync(srcDir)) walk(srcDir, root, runtimeFiles);

  const empty = {} as never;
  const pick = <T>(name: string): T => (manifests[name] as T | undefined) ?? empty;

  return {
    root,
    loadProblems: problems,
    invariants: pick('invariants.json'),
    actionMatrix: pick('action-matrix.json'),
    slices: pick('slices.json'),
    triage: pick('test-triage.json'),
    findings: pick('findings.json'),
    decisions: pick('decisions.json'),
    gates: pick('gates.json'),
    taskState: pick('task-state.json'),
    evidenceModel: pick('evidence-model.json'),
    policyParameters: pick('policy-parameters.json'),
    nonWaivable: pick('non-waivable.json'),
    pr1Ordering: pick('pr1-ordering.json'),
    docs,
    runtimeFiles,
    configs: {
      'tsconfig.build.json': readOptionalText(join(root, 'tsconfig.build.json')),
      'package.json': readOptionalText(join(root, 'package.json')),
    },
  };
}

export { REQUIRED_DOCS, REQUIRED_MANIFESTS };
