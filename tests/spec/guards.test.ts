// PR-0 is specification-only. These guards assert that as a property of the tree,
// not as a claim in prose.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { loadBundle, repoRoot } from '../../tools/spec/load.js';
import { REQUIRED_DOCS, REQUIRED_MANIFESTS } from '../../tools/spec/anchors.js';
import { stripComments } from '../../tools/spec/checks.js';

const root = repoRoot();
const bundle = loadBundle(root);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'coverage') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(relative(root, full).split(sep).join('/'));
  }
  return acc;
}

const tracked = walk(root);

describe('PR-0 carries no runtime implementation', () => {
  it('ships no src/ directory', () => {
    expect(existsSync(join(root, 'src'))).toBe(false);
  });

  it('ships no schema or migration files', () => {
    const offending = tracked.filter((p) => p.endsWith('.sql') || /(^|\/)migrations?(\/|$)/.test(p));
    expect(offending).toEqual([]);
  });

  it('keeps every TypeScript file it ships inside the specification toolchain', () => {
    const code = tracked.filter((p) => p.endsWith('.ts') && !p.endsWith('.config.ts'));
    for (const p of code) {
      expect(p.startsWith('tools/spec/') || p.startsWith('tests/spec/'), `${p} is outside the specification toolchain`).toBe(true);
    }
  });
});

describe('the validator is outside the runtime build, package and export surface', () => {
  it('is excluded from the runtime build', () => {
    const build = JSON.parse(readFileSync(join(root, 'tsconfig.build.json'), 'utf8')) as { include: string[] };
    expect(build.include).toEqual(['src/**/*.ts']);
  });

  it('is not reachable from any package entry point or published file list', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
    const entries = JSON.stringify({ main: pkg['main'], exports: pkg['exports'], bin: pkg['bin'], files: pkg['files'] });
    expect(entries).not.toContain('tools/');
  });

  it('is not imported by anything under src/, when src/ exists', () => {
    // Vacuously true in PR-0. The guard exists so PR-A cannot quietly break it, and the
    // mutation fixtures prove it fires on static, literal-dynamic, require and computed
    // specifiers.
    for (const file of bundle.runtimeFiles) {
      expect(stripComments(file.content), file.path).not.toMatch(/tools\/spec|spec\/manifests/);
    }
  });

  it('reads only specification files, source it polices, and two config files', () => {
    const loader = readFileSync(join(root, 'tools', 'spec', 'load.ts'), 'utf8');
    const reads = [...loader.matchAll(/join\(root,\s*'([^']+)'/g)].map((m) => m[1]);
    for (const r of reads) {
      expect(['spec', 'src', 'tsconfig.build.json', 'package.json']).toContain(r);
    }
  });
});

describe('the specification is complete on its own terms', () => {
  it('ships every document the anchor requires', () => {
    for (const file of REQUIRED_DOCS) {
      expect(existsSync(join(root, 'spec', file)), file).toBe(true);
      expect((bundle.docs[file] ?? '').trim().length, file).toBeGreaterThan(0);
    }
  });

  it('ships every manifest the anchor requires', () => {
    for (const manifest of REQUIRED_MANIFESTS) {
      expect(existsSync(join(root, 'spec', 'manifests', manifest)), manifest).toBe(true);
    }
  });

  it('exposes the documented commands', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['spec:validate']).toBeTruthy();
    expect(pkg.scripts['spec:render']).toBeTruthy();
  });

  it('records that PR-0 is specification-only in the slice manifest', () => {
    const pr0 = bundle.slices.slices.find((s) => s.id === 'PR-0')!;
    expect(pr0.classification).toBe('specification-only');
    expect(pr0.migration).toBeNull();
  });

  it('keeps the docs-only CI boundary conditional on the base, not on this branch', () => {
    const workflow = readFileSync(join(root, '.github', 'workflows', 'spec.yml'), 'utf8');
    // The marker is read from the base commit, so a PR cannot declare itself exempt.
    expect(workflow).toMatch(/git cat-file -e "\$BASE:spec\/manifests\/invariants\.json"/);
    expect(workflow).not.toMatch(/\$HEAD:spec\/manifests\/invariants\.json/);
  });
});
