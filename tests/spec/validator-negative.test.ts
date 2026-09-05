// The mutation matrix, executed as tests.
//
// The fixtures themselves live in tools/spec/fixtures.ts so the validator can execute them
// too: a fixture that stops provoking its code fails `spec:validate` as well as this suite.

import { describe, it, expect } from 'vitest';
import { loadBundle, repoRoot } from '../../tools/spec/load.js';
import { runChecks } from '../../tools/spec/checks.js';
import { fixtures } from '../../tools/spec/fixtures.js';
import { FIXTURE_EXEMPT_CODES } from '../../tools/spec/anchors.js';
import { FAILURE_CODES } from '../../tools/spec/checks.js';

const pristine = loadBundle(repoRoot());

describe('every check can fail', () => {
  for (const [index, fixture] of fixtures.entries()) {
    it(`${index + 1}. ${fixture.code}: ${fixture.why}`, () => {
      const b = structuredClone(pristine);
      fixture.mutate(b);
      const codes = runChecks(b, { skipFixtureExecution: true }).map((p) => p.code);
      expect(codes).toContain(fixture.code);
    });
  }

  it('covers every failure code that a bundle mutation can reach', () => {
    const covered = new Set(fixtures.map((f) => f.code));
    const uncovered = FAILURE_CODES
      .filter((c) => !FIXTURE_EXEMPT_CODES.includes(c))
      .filter((c) => !covered.has(c));
    expect(uncovered).toEqual([]);
  });

  it('leaves the pristine bundle clean, so the fixtures are what turn the checks red', () => {
    expect(runChecks(structuredClone(pristine), { skipFixtureExecution: true })).toEqual([]);
  });
});
