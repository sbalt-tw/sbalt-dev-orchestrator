// The mutation matrix.
//
// One fixture per failure class. Each mutates a clone of the real bundle in a way that
// must turn its declared check red. The validator executes every fixture and reports
// NEGATIVE_FIXTURE_INERT if one of them fails to provoke its code, so a guard that has
// never been seen to fire cannot survive here.
//
// The two self-referential codes — NEGATIVE_FIXTURE_MISSING and NEGATIVE_FIXTURE_INERT —
// cannot be provoked by mutating a bundle, because they are produced by the fixture runner
// itself. They are covered by direct unit tests in tests/spec/validator.test.ts, and the
// anchor records that exemption explicitly.

import type { SpecBundle } from './types.js';
import type { FailureCode } from './checks.js';
import { registerFixtures } from './checks.js';

export interface Fixture {
  code: FailureCode;
  why: string;
  mutate: (b: SpecBundle) => void;
}

const invariant = (b: SpecBundle, id: string) => b.invariants.invariants.find((i) => i.id === id)!;
const slice = (b: SpecBundle, id: string) => b.slices.slices.find((s) => s.id === id)!;
const gate = (b: SpecBundle, id: string) => b.gates.gates.find((g) => g.id === id)!;
const decision = (b: SpecBundle, id: string) => b.decisions.decisions.find((d) => d.id === id)!;

export const fixtures: Fixture[] = [
  // ---- bundle integrity -------------------------------------------------------------
  { code: 'BUNDLE_LOAD', why: 'a load problem is swallowed instead of surfaced',
    mutate: (b) => { b.loadProblems.push({ code: 'MANIFEST_MALFORMED', detail: 'spec/manifests/gates.json does not parse' }); } },
  { code: 'DOC_MISSING', why: 'a required document disappears',
    mutate: (b) => { delete b.docs['03-evidence.md']; } },
  { code: 'DOC_EMPTY', why: 'a required document is present but empty',
    mutate: (b) => { b.docs['03-evidence.md'] = ''; } },
  { code: 'MANIFEST_MISSING', why: 'a required manifest fails to load',
    mutate: (b) => { b.taskState = {} as SpecBundle['taskState']; } },

  // ---- invariants -------------------------------------------------------------------
  { code: 'INVARIANT_ID_SET', why: 'an invariant is removed',
    mutate: (b) => { b.invariants.invariants.pop(); } },
  { code: 'INVARIANT_FAMILY_MEMBERSHIP', why: 'an invariant is moved to another family',
    mutate: (b) => { invariant(b, 'INV-A9').family = 'E'; } },
  { code: 'FAMILY_SET', why: 'a family disappears from the family table',
    mutate: (b) => { delete b.invariants.families['M']; } },
  { code: 'OWNERSHIP_INCOMPLETE', why: 'an invariant loses its test owner',
    mutate: (b) => { invariant(b, 'INV-A1').owners.test = []; } },
  { code: 'PERSISTENCE_NA_NOT_PERMITTED', why: 'an invariant claims n/a persistence without permission',
    mutate: (b) => { invariant(b, 'INV-A2').owners.persistence = ['n/a']; } },
  { code: 'SLICE_LINEAGE_MISSING', why: 'an invariant names no introducing slice',
    mutate: (b) => { invariant(b, 'INV-A1').introducing_slice = ''; } },
  { code: 'CONFORMANCE_TEST_MISSING', why: 'an invariant names no positive test',
    mutate: (b) => { const i = invariant(b, 'INV-A1'); i.tests = i.tests.filter((t) => t.kind !== 'positive'); } },
  { code: 'NEGATIVE_TEST_MISSING', why: 'an invariant names no negative test',
    mutate: (b) => { const i = invariant(b, 'INV-A1'); i.tests = i.tests.filter((t) => t.kind !== 'negative'); } },
  { code: 'TEST_NAME_DUPLICATE', why: 'two invariants claim the same test name',
    mutate: (b) => { invariant(b, 'INV-A2').tests[0]!.name = invariant(b, 'INV-A1').tests[0]!.name; } },
  { code: 'ERRATA_MAP_MISMATCH', why: 'an erratum stops reaching an invariant it governs',
    mutate: (b) => { invariant(b, 'INV-A1').errata = []; } },
  { code: 'DECISION_MAP_MISMATCH', why: 'a Founder decision stops reaching an invariant it governs',
    mutate: (b) => { invariant(b, 'INV-S1').decisions = []; } },

  // ---- action matrix ----------------------------------------------------------------
  { code: 'MATRIX_KIND_SET', why: 'an action kind is removed',
    mutate: (b) => { delete b.actionMatrix.kinds['worker_dispatch']; } },
  { code: 'MATRIX_FIELD_SET', why: 'an envelope field is removed from the field list',
    mutate: (b) => { b.actionMatrix.fields.pop(); } },
  { code: 'MATRIX_CELL_MISMATCH', why: 'a cell is widened away from its anchored disposition',
    mutate: (b) => { b.actionMatrix.kinds['merge']!.fields['evidence_snapshot_ref'] = 'OPTIONAL'; } },
  { code: 'MATRIX_CENSUS', why: 'the census disagrees with the anchored dimensions',
    mutate: (b) => { b.actionMatrix.census.cells = 150; } },
  { code: 'MATRIX_DISPOSITION_SET', why: 'the manifest invents a fifth disposition',
    mutate: (b) => { (b.actionMatrix.dispositions as string[]).push('MAYBE'); } },
  { code: 'MATRIX_FIXED_VALUE', why: 'a fixed use limit is changed',
    mutate: (b) => { b.actionMatrix.kinds['merge']!.fixed_values['use_limit'] = 5; } },
  { code: 'MATRIX_GROUP_MISMATCH', why: 'a grouped kind makes one provenance member individually required',
    mutate: (b) => { b.actionMatrix.kinds['staging_write']!.fields['base_sha'] = 'REQUIRED'; } },
  { code: 'MATRIX_TARGET_SCHEME', why: 'a canonical target uses an undefined scheme',
    mutate: (b) => { b.actionMatrix.kinds['merge']!.canonical_target = 'ftp://example'; } },

  // ---- slices -----------------------------------------------------------------------
  { code: 'SLICE_ORDER_MISMATCH', why: 'the total order is reshuffled',
    mutate: (b) => { const o = b.slices.total_order; [o[2], o[3]] = [o[3] as string, o[2] as string]; } },
  { code: 'SLICE_MERGE_PREDECESSOR', why: 'a merge predecessor skips a slice',
    mutate: (b) => { slice(b, 'PR-C').merge_predecessor = 'PR-A'; } },
  { code: 'SLICE_SCHEMA_PREDECESSOR', why: 'a slice names a schema predecessor no earlier slice produces',
    mutate: (b) => { slice(b, 'PR-E').schema_predecessor = 'v2'; } },
  { code: 'SLICE_DEPENDENCY_FORWARD', why: 'a slice depends on one that comes after it',
    mutate: (b) => { slice(b, 'PR-B').functional_dependencies.push('PR-H'); } },
  { code: 'MIGRATION_CHAIN', why: 'a migration version is skipped',
    mutate: (b) => { slice(b, 'PR-D').migration = 'v9'; } },

  // ---- task state -------------------------------------------------------------------
  { code: 'TASK_STATE_SET', why: 'a task state is removed from the vocabulary',
    mutate: (b) => { b.taskState.states.pop(); } },
  { code: 'TASK_TERMINAL_SET', why: 'a terminal state is removed',
    mutate: (b) => { b.taskState.terminal_states.pop(); } },
  { code: 'TASK_EVENT_SET', why: 'an event is removed from the closed vocabulary',
    mutate: (b) => { b.taskState.events.pop(); } },
  { code: 'TASK_OBLIGATION_SET', why: 'an obligation kind disappears',
    mutate: (b) => { b.taskState.obligations.WAITING.pop(); } },
  { code: 'TASK_TABLE_NOT_TOTAL', why: 'a (state, event) pair loses its explicit decision',
    mutate: (b) => { b.taskState.transitions.pop(); } },
  { code: 'TASK_TERMINAL_HAS_OUTGOING', why: 'a terminal state is given an outgoing transition',
    mutate: (b) => {
      const t = b.taskState.transitions.find((x) => x.from === 'SUCCEEDED')!;
      t.decision = 'ALLOWED';
      t.target_rule = 'RUNNING';
    } },
  { code: 'TASK_TARGET_CHOSEN_BY_CALLER', why: 'the caller contract stops forbidding a submitted target state',
    mutate: (b) => { b.taskState.caller_contract.never_submits = []; } },
  { code: 'TASK_SUCCESS_PRECONDITIONS', why: 'a success precondition is dropped',
    mutate: (b) => { b.taskState.success_preconditions.pop(); } },
  { code: 'TASK_ABANDONMENT_RULES', why: 'an abandonment rule is dropped',
    mutate: (b) => { b.taskState.abandonment_rules.pop(); } },

  // ---- evidence ---------------------------------------------------------------------
  { code: 'EVIDENCE_CONTENT_FIELDS', why: 'the slot identity is dropped from the content digest',
    mutate: (b) => { b.evidenceModel.content_fields = b.evidenceModel.content_fields.filter((f) => f.name !== 'evidence_slot_identity'); } },
  { code: 'EVIDENCE_ORDERING', why: 'ordering falls back to the timestamp',
    mutate: (b) => { b.evidenceModel.ordering.authoritative = 'observed_at'; } },
  { code: 'EVIDENCE_TIEBREAK', why: 'the forbidden tie-breaks are removed',
    mutate: (b) => { b.evidenceModel.ordering.forbidden_tiebreaks = []; } },
  { code: 'EVIDENCE_CONFLICT', why: 'two digests at one generation stop being a conflict',
    mutate: (b) => { b.evidenceModel.conflict['same_generation_different_digest'] = 'the later row wins'; } },

  // ---- policy -----------------------------------------------------------------------
  { code: 'POLICY_PARAMETER_MISMATCH', why: 'a bounded policy parameter is widened',
    mutate: (b) => { b.policyParameters.parameters[0]!.maximum = Number.MAX_SAFE_INTEGER; } },
  { code: 'INFRA_ATTEMPTS', why: 'the infrastructure attempt limit is raised',
    mutate: (b) => { b.policyParameters.infrastructure_retry['attempts'] = 5; } },

  // ---- non-waivable -----------------------------------------------------------------
  { code: 'NON_WAIVABLE_SET', why: 'a non-waivable subject is removed',
    mutate: (b) => { b.nonWaivable.non_waivable.pop(); } },
  { code: 'NON_WAIVABLE_DEFAULT', why: 'unmarked policies stop being non-waivable by default',
    mutate: (b) => { b.nonWaivable.waivable_targets.default = 'Anything unmarked may be weakened.'; } },
  { code: 'GATE_WAIVABLE', why: 'a phase gate is marked waivable',
    mutate: (b) => { gate(b, 'phase1a_entry').waivable = true; } },

  // ---- decisions --------------------------------------------------------------------
  { code: 'DECISION_SET', why: 'a decision is removed from the ledger',
    mutate: (b) => { b.decisions.decisions.pop(); } },
  { code: 'DECISION_STATE_MISMATCH', why: 'an approved decision is downgraded',
    mutate: (b) => { decision(b, 'D11').state = 'DEFERRED'; } },
  { code: 'DECISION_AMENDMENT_MISSING', why: 'an amended decision loses its amendment list',
    mutate: (b) => { delete (decision(b, 'D1') as { amended_by?: string[] }).amended_by; } },
  { code: 'STANDING_AUTHORIZATION', why: 'a standing prohibition is quietly granted',
    mutate: (b) => { b.decisions.standing_authorizations[0]!.state = 'APPROVED'; } },

  // ---- gates ------------------------------------------------------------------------
  { code: 'GATE_ID_SET', why: 'a gate is renamed',
    mutate: (b) => { gate(b, 'phase1a_entry').id = 'phase_one_a'; } },
  { code: 'GATE_CONDITION_SET', why: 'a gate condition is deleted',
    mutate: (b) => { gate(b, 'phase0_completion').conditions.pop(); } },
  { code: 'GATE_NOT_SEPARATE', why: 'one condition serves both gates',
    mutate: (b) => { gate(b, 'phase1a_entry').conditions.push({ ...gate(b, 'phase0_completion').conditions[0]! }); } },
  { code: 'GATE_PHASE_LEAK', why: 'a Phase 0 condition is made to depend on a deferred Phase 1A decision',
    mutate: (b) => { gate(b, 'phase0_completion').conditions[0]!.text = 'D14 is decided and every slice is merged.'; } },
  { code: 'GATE_G0_8_WEAK', why: 'G0-8 stops rejecting abandoned and unknown effects',
    mutate: (b) => { gate(b, 'phase0_completion').conditions.find((c) => c.id === 'G0-8')!.rejects = []; } },
  { code: 'GATE_DECISION_REQUIREMENT', why: 'a Phase 1A condition is satisfied by the presence of a decision row',
    mutate: (b) => { gate(b, 'phase1a_entry').conditions.find((c) => c.id === 'G1-2')!.requires_decision = null; } },

  // ---- triage -----------------------------------------------------------------------
  { code: 'TRIAGE_ROW_COUNT', why: 'the triage loses a row',
    mutate: (b) => { b.triage.rows.pop(); } },
  { code: 'TRIAGE_ROW_DUPLICATE', why: 'two rows carry the same number',
    mutate: (b) => { b.triage.rows[1]!.row = b.triage.rows[0]!.row; } },
  { code: 'TRIAGE_DISPOSITION_UNKNOWN', why: 'a row carries a disposition outside the closed set',
    mutate: (b) => { (b.triage.rows[0] as unknown as Record<string, string>)['disposition'] = 'MAYBE'; } },
  { code: 'TRIAGE_FIELD_MISSING', why: 'a REWRITE names no replacement test',
    mutate: (b) => { b.triage.rows.find((r) => r.disposition === 'REWRITE')!.replacement = null; } },
  { code: 'TRIAGE_INVARIANT_UNKNOWN', why: 'a row maps to an invariant that does not exist',
    mutate: (b) => { b.triage.rows[0]!.invariants = ['INV-Z9']; } },
  { code: 'TRIAGE_CENSUS', why: 'the census disagrees with the rows',
    mutate: (b) => { b.triage.census.KEEP += 1; } },
  { code: 'TRIAGE_SOURCE_HEAD', why: 'a row is attributed to a head other than the frozen one',
    mutate: (b) => { b.triage.rows[0]!.source_head = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'; } },
  { code: 'TRIAGE_MAPPING_BASIS', why: 'a row declares a basis outside the closed set',
    mutate: (b) => { (b.triage.rows[0] as unknown as Record<string, string>)['mapping_basis'] = 'guess'; } },
  { code: 'TRIAGE_SLICE_LOCAL_SET', why: 'a row is quietly reclassified as slice-local',
    mutate: (b) => {
      const r = b.triage.rows[0]!;
      r.mapping_basis = 'slice_local';
      r.invariants = [];
      r.slice_local = { owner_slice: 'PR-H', named_test: 'x/y', why_no_invariant: 'because' };
    } },
  { code: 'TRIAGE_SOURCE_FILE_COUNTS', why: 'a row is reattributed to a different source file',
    mutate: (b) => { b.triage.rows[0]!.source_file = 'tests/workers.test.ts'; } },

  // ---- findings ---------------------------------------------------------------------
  { code: 'FINDING_ID_SET', why: 'a historical finding is dropped',
    mutate: (b) => { b.findings.findings.pop(); } },
  { code: 'FINDING_UNMAPPED', why: 'a finding maps to no invariant',
    mutate: (b) => { b.findings.findings[0]!.invariants = []; } },
  { code: 'FINDING_ROUND_ACCOUNTING', why: 'a round claims more itemised findings than it holds',
    mutate: (b) => { b.findings.rounds[0]!.itemised += 1; } },
  { code: 'DEBT_ID_SET', why: 'a carried debt item disappears',
    mutate: (b) => { b.findings.carried_debt.pop(); } },
  { code: 'DEBT_NOT_TESTABLE', why: 'DEBT-2 loses its exit condition and becomes an opinion again',
    mutate: (b) => { delete b.findings.carried_debt.find((d) => d.id === 'DEBT-2')!.exit_condition; } },
  { code: 'PR0_FINDING_SET', why: 'a Round-1 finding is dropped from the closure record',
    mutate: (b) => { b.findings.pr0_review.findings.pop(); } },
  { code: 'PR0_VERDICT_MISMATCH', why: 'the recorded Round-1 verdict is softened',
    mutate: (b) => { b.findings.pr0_review.rounds[0]!.verdict['blocker'] = 0; } },

  // ---- PR #1 ------------------------------------------------------------------------
  { code: 'PR1_ORDERING_ALTERED', why: 'closing PR #1 is moved ahead of merging PR-0',
    mutate: (b) => {
      const steps = b.pr1Ordering.steps;
      const four = steps.find((s) => s.step === 4)!;
      const five = steps.find((s) => s.step === 5)!;
      const swap = four.action;
      four.action = five.action;
      five.action = swap;
    } },
  { code: 'PR1_FROZEN_HEAD', why: 'the frozen PR #1 head is changed',
    mutate: (b) => { b.pr1Ordering.pr1.frozen_head = '0000000000000000000000000000000000000000'; } },

  // ---- the runtime boundary ---------------------------------------------------------
  { code: 'RUNTIME_IMPORTS_SPEC', why: 'runtime code statically imports the specification toolchain',
    mutate: (b) => { b.runtimeFiles.push({ path: 'src/orchestrator.ts', content: "import { runChecks } from '../tools/spec/checks.js';\n" }); } },
  { code: 'RUNTIME_IMPORTS_SPEC', why: 'runtime code requires a manifest by a literal path',
    mutate: (b) => { b.runtimeFiles.push({ path: 'src/state/db.ts', content: "const m = require('../spec/manifests/invariants.json');\n" }); } },
  { code: 'RUNTIME_IMPORTS_SPEC', why: 'runtime code loads a manifest through a literal dynamic import',
    mutate: (b) => { b.runtimeFiles.push({ path: 'src/policy/load.ts', content: "await import('../../spec/manifests/gates.json');\n" }); } },
  { code: 'RUNTIME_DYNAMIC_IMPORT', why: 'runtime code builds a specifier by concatenation so no literal appears',
    mutate: (b) => { b.runtimeFiles.push({ path: 'src/policy/sneak.ts', content: "const p = '../spec/' + 'manifests/invariants.json';\nawait import(p);\n" }); } },
  { code: 'RUNTIME_DYNAMIC_IMPORT', why: 'runtime code hides a computed require behind createRequire',
    mutate: (b) => { b.runtimeFiles.push({ path: 'src/policy/sneak2.ts', content: "const r = createRequire(import.meta.url);\nr(base + '/manifests/invariants.json');\n" }); } },
  { code: 'BUILD_INCLUDES_TOOLS', why: 'the runtime build pulls tools/ in',
    mutate: (b) => { b.configs['tsconfig.build.json'] = '{ "include": ["src/**/*.ts", "tools/**/*.ts"] }'; } },
  { code: 'BUILD_INCLUDES_TOOLS', why: 'a package entry point resolves into tools/',
    mutate: (b) => { b.configs['package.json'] = JSON.stringify({ main: './tools/spec/validate.js' }); } },

  // ---- documents --------------------------------------------------------------------
  { code: 'DOC_INVARIANT_DRIFT', why: 'the generated invariant document is edited by hand',
    mutate: (b) => { b.docs['01-invariants.md'] = '# 01 · The 47 invariants\n\nedited by hand\n'; } },
];

registerFixtures({ fixtures });
