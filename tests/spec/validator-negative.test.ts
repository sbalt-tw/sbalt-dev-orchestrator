// Every failure class the validator can report must have a fixture here that
// deliberately provokes it. A guard that never fires is not a guard: these fixtures
// are what prove each check can go red.

import { describe, it, expect } from 'vitest';
import { loadBundle, repoRoot } from '../../tools/spec/load.js';
import { runChecks, FAILURE_CODES } from '../../tools/spec/checks.js';
import type { SpecBundle } from '../../tools/spec/types.js';

const pristine = loadBundle(repoRoot());

function clone(): SpecBundle {
  // structuredClone keeps the fixtures independent of each other.
  return structuredClone(pristine);
}

type Mutator = (b: SpecBundle) => void;

const fixtures: { code: string; why: string; mutate: Mutator }[] = [
  {
    code: 'INVARIANT_CENSUS',
    why: 'an invariant is removed while the census still claims 47',
    mutate: (b) => { b.invariants.invariants.pop(); },
  },
  {
    code: 'FAMILY_CENSUS',
    why: 'a family disappears from the family table',
    mutate: (b) => { delete b.invariants.families['M']; },
  },
  {
    code: 'INVARIANT_ID_SHAPE',
    why: 'an id stops following INV-<family><serial>',
    mutate: (b) => { b.invariants.invariants[0]!.id = 'INVARIANT-ONE'; },
  },
  {
    code: 'INVARIANT_ID_DUPLICATE',
    why: 'two invariants claim the same id',
    mutate: (b) => { b.invariants.invariants[1]!.id = b.invariants.invariants[0]!.id; },
  },
  {
    code: 'INVARIANT_FAMILY_SERIES',
    why: 'a family serial jumps, leaving a hole',
    mutate: (b) => { b.invariants.invariants[0]!.id = 'INV-A99'; },
  },
  {
    code: 'OWNERSHIP_INCOMPLETE',
    why: 'an invariant loses its test owner',
    mutate: (b) => { b.invariants.invariants[0]!.owners.test = []; },
  },
  {
    code: 'OWNERSHIP_INCOMPLETE',
    why: 'an n/a persistence owner carries no explanation',
    mutate: (b) => { delete b.invariants.invariants[0]!.owners.persistence_note; },
  },
  {
    code: 'SLICE_LINEAGE_MISSING',
    why: 'an invariant names no introducing slice',
    mutate: (b) => { b.invariants.invariants[0]!.introducing_slice = ''; },
  },
  {
    code: 'CONFORMANCE_TEST_MISSING',
    why: 'an invariant names no positive conformance test',
    mutate: (b) => {
      const inv = b.invariants.invariants[0]!;
      inv.tests = inv.tests.filter((t) => t.kind !== 'positive');
    },
  },
  {
    code: 'NEGATIVE_TEST_MISSING',
    why: 'an invariant names no negative test',
    mutate: (b) => {
      const inv = b.invariants.invariants[0]!;
      inv.tests = inv.tests.filter((t) => t.kind !== 'negative');
    },
  },
  {
    code: 'TEST_NAME_DUPLICATE',
    why: 'two invariants claim the same conformance test name',
    mutate: (b) => {
      b.invariants.invariants[1]!.tests[0]!.name = b.invariants.invariants[0]!.tests[0]!.name;
    },
  },
  {
    code: 'ERRATA_UNMAPPED',
    why: 'an erratum reaches no invariant',
    mutate: (b) => { for (const i of b.invariants.invariants) i.errata = []; },
  },
  {
    code: 'MATRIX_NOT_TOTAL',
    why: 'an action kind stops dispositioning one of the 25 fields',
    mutate: (b) => { delete b.actionMatrix.kinds['merge']!.fields['justification']; },
  },
  {
    code: 'MATRIX_BAD_DISPOSITION',
    why: 'a cell holds a disposition outside the closed set',
    mutate: (b) => {
      (b.actionMatrix.kinds['merge']!.fields as Record<string, string>)['justification'] = 'MAYBE';
    },
  },
  {
    code: 'MATRIX_ALWAYS_REQUIRED',
    why: 'a common field stops being required in one kind',
    mutate: (b) => { b.actionMatrix.kinds['merge']!.fields['outcome'] = 'OPTIONAL'; },
  },
  {
    code: 'MATRIX_FIXED_WITHOUT_VALUE',
    why: 'a FIXED field carries no fixed value',
    mutate: (b) => { delete b.actionMatrix.kinds['merge']!.fixed_values['use_limit']; },
  },
  {
    code: 'MATRIX_GROUP_INCONSISTENT',
    why: 'a member of an all-or-nothing group becomes individually required',
    mutate: (b) => { b.actionMatrix.kinds['staging_write']!.fields['base_sha'] = 'REQUIRED'; },
  },
  {
    code: 'MATRIX_ISOLATED_PROVENANCE',
    why: 'a kind permits a head without requiring the repository and base with it',
    mutate: (b) => { b.actionMatrix.kinds['merge']!.fields['repository_identity'] = 'OPTIONAL'; },
  },
  {
    code: 'MATRIX_TARGET_SCHEME_UNKNOWN',
    why: 'a canonical target uses a scheme the identity chapter does not define',
    mutate: (b) => { b.actionMatrix.kinds['merge']!.canonical_target = 'ftp://example'; },
  },
  {
    code: 'SLICE_ORDER_CYCLE',
    why: 'a slice depends on one that comes after it',
    mutate: (b) => {
      b.slices.slices.find((s) => s.id === 'PR-B')!.functional_dependencies.push('PR-H');
    },
  },
  {
    code: 'SLICE_MERGE_PREDECESSOR',
    why: 'a merge predecessor skips the immediately preceding slice',
    mutate: (b) => {
      b.slices.slices.find((s) => s.id === 'PR-C')!.merge_predecessor = 'PR-A';
    },
  },
  {
    code: 'SLICE_SCHEMA_PREDECESSOR',
    why: 'a slice names a schema predecessor no earlier slice produces',
    mutate: (b) => {
      b.slices.slices.find((s) => s.id === 'PR-E')!.schema_predecessor = 'v2';
    },
  },
  {
    code: 'MIGRATION_CHAIN',
    why: 'the migration chain skips a version',
    mutate: (b) => {
      b.slices.slices.find((s) => s.id === 'PR-D')!.migration = 'v9';
    },
  },
  {
    code: 'TRIAGE_ROW_COUNT',
    why: 'the triage loses a row',
    mutate: (b) => { b.triage.rows.pop(); },
  },
  {
    code: 'TRIAGE_ROW_DUPLICATE',
    why: 'two triage rows carry the same number',
    mutate: (b) => { b.triage.rows[1]!.row = b.triage.rows[0]!.row; },
  },
  {
    code: 'TRIAGE_DISPOSITION_UNKNOWN',
    why: 'a triage row carries a disposition outside KEEP, REWRITE and DROP',
    mutate: (b) => {
      (b.triage.rows[0] as unknown as Record<string, string>)['disposition'] = 'MAYBE';
    },
  },
  {
    code: 'TRIAGE_FIELD_MISSING',
    why: 'a DROP carries no rationale',
    mutate: (b) => {
      const row = b.triage.rows.find((r) => r.disposition === 'DROP')!;
      row.rationale = '';
    },
  },
  {
    code: 'TRIAGE_FIELD_MISSING',
    why: 'a REWRITE names no replacement test',
    mutate: (b) => {
      const row = b.triage.rows.find((r) => r.disposition === 'REWRITE')!;
      row.replacement = null;
    },
  },
  {
    code: 'TRIAGE_INVARIANT_UNKNOWN',
    why: 'a triage row maps to an invariant that does not exist',
    mutate: (b) => { b.triage.rows[0]!.invariants = ['INV-Z9']; },
  },
  {
    code: 'TRIAGE_CENSUS',
    why: 'the triage census disagrees with the rows',
    mutate: (b) => { b.triage.census.KEEP += 1; },
  },
  {
    code: 'TRIAGE_SOURCE_HEAD',
    why: 'a triage row is attributed to a head other than the frozen one',
    mutate: (b) => { b.triage.rows[0]!.source_head = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'; },
  },
  {
    code: 'FINDING_UNMAPPED',
    why: 'a finding maps to no invariant',
    mutate: (b) => { b.findings.findings[0]!.invariants = []; },
  },
  {
    code: 'FINDING_ROUND_ACCOUNTING',
    why: 'a round claims more itemised findings than it holds',
    mutate: (b) => { b.findings.rounds[0]!.itemised += 1; },
  },
  {
    code: 'FINDING_ROUND_ACCOUNTING',
    why: 'a round leaves findings unaccounted for with no debt entry',
    mutate: (b) => { b.findings.rounds[0]!.unitemised_debt = null; },
  },
  {
    code: 'DEBT_UNMAPPED',
    why: 'a carried debt item maps to no invariant',
    mutate: (b) => { b.findings.carried_debt[0]!.invariants = []; },
  },
  {
    code: 'DECISION_SET',
    why: 'the ledger loses a decision',
    mutate: (b) => { b.decisions.decisions.pop(); },
  },
  {
    code: 'DECISION_STATE_ILLEGAL',
    why: 'a decision carries a state outside the legal set',
    mutate: (b) => { b.decisions.decisions[0]!.state = 'PROBABLY'; },
  },
  {
    code: 'GATE_NOT_SEPARATE',
    why: 'a condition appears in both gates',
    mutate: (b) => {
      const phase0 = b.gates.gates.find((g) => g.id === 'phase0_completion')!;
      const phase1a = b.gates.gates.find((g) => g.id === 'phase1a_entry')!;
      phase1a.conditions.push({ ...phase0.conditions[0]! });
    },
  },
  {
    code: 'GATE_PHASE_LEAK',
    why: 'the Phase 0 gate is made to depend on a deferred Phase 1A decision',
    mutate: (b) => {
      b.gates.gates
        .find((g) => g.id === 'phase0_completion')!
        .conditions.push({ id: 'G0-99', text: 'D14 is decided.' });
    },
  },
  {
    code: 'PR1_ORDERING_ALTERED',
    why: 'a step of the PR #1 ordering is removed',
    mutate: (b) => {
      b.docs['11-pr1-disposition.md'] = (b.docs['11-pr1-disposition.md'] ?? '').replace(
        'Founder **separately** authorises closing PR #1',
        'PR #1 may be closed at any convenient point',
      );
    },
  },
  {
    code: 'RUNTIME_IMPORTS_SPEC',
    why: 'runtime code imports the specification toolchain',
    mutate: (b) => {
      b.runtimeFiles.push({
        path: 'src/orchestrator.ts',
        content: "import { runChecks } from '../tools/spec/checks.js';\n",
      });
    },
  },
  {
    code: 'BUILD_INCLUDES_TOOLS',
    why: 'the runtime build pulls tools/ in',
    mutate: (b) => {
      b.configs['tsconfig.build.json'] = '{ "include": ["src/**/*.ts", "tools/**/*.ts"] }';
    },
  },
  {
    code: 'BUILD_INCLUDES_TOOLS',
    why: 'a package entry point resolves into tools/',
    mutate: (b) => {
      b.configs['package.json'] = JSON.stringify({ main: './tools/spec/validate.js' });
    },
  },
  {
    code: 'DOC_INVARIANT_DRIFT',
    why: 'the generated invariant document is edited by hand',
    mutate: (b) => { b.docs['01-invariants.md'] = '# 01 · The 47 invariants\n\nedited by hand\n'; },
  },
  {
    code: 'NEGATIVE_FIXTURE_MISSING',
    why: 'a failure class loses its fixture',
    mutate: (b) => { b.configs['tests/spec/validator-negative.test.ts'] = ''; },
  },
];

describe('every check can fail', () => {
  for (const fixture of fixtures) {
    it(`${fixture.code}: ${fixture.why}`, () => {
      const b = clone();
      fixture.mutate(b);
      const codes = runChecks(b).map((p) => p.code);
      expect(codes).toContain(fixture.code);
    });
  }

  it('covers every declared failure code', () => {
    const covered = new Set(fixtures.map((f) => f.code));
    const uncovered = FAILURE_CODES.filter((c) => !covered.has(c));
    expect(uncovered).toEqual([]);
  });

  it('leaves the pristine bundle clean, so the fixtures are what turn the checks red', () => {
    expect(runChecks(clone())).toEqual([]);
  });
});
