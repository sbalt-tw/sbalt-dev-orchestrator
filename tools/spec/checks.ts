// Mechanical checks over the specification bundle.
//
// Every expectation comes from ./anchors.js, never from the manifest being checked. A
// manifest that rewrites its own declaration of what is legal changes nothing here.

import type { SpecBundle, Disposition } from './types.js';
import { renderInvariants } from './render.js';
import * as A from './anchors.js';

export const FAILURE_CODES = [
  // bundle integrity
  'BUNDLE_LOAD',
  'DOC_MISSING',
  'DOC_EMPTY',
  'MANIFEST_MISSING',
  // invariants
  'INVARIANT_ID_SET',
  'INVARIANT_FAMILY_MEMBERSHIP',
  'FAMILY_SET',
  'OWNERSHIP_INCOMPLETE',
  'PERSISTENCE_NA_NOT_PERMITTED',
  'SLICE_LINEAGE_MISSING',
  'CONFORMANCE_TEST_MISSING',
  'NEGATIVE_TEST_MISSING',
  'TEST_NAME_DUPLICATE',
  'ERRATA_MAP_MISMATCH',
  'DECISION_MAP_MISMATCH',
  // action matrix
  'MATRIX_KIND_SET',
  'MATRIX_FIELD_SET',
  'MATRIX_CELL_MISMATCH',
  'MATRIX_CENSUS',
  'MATRIX_DISPOSITION_SET',
  'MATRIX_FIXED_VALUE',
  'MATRIX_GROUP_MISMATCH',
  'MATRIX_TARGET_SCHEME',
  // slices
  'SLICE_ORDER_MISMATCH',
  'SLICE_MERGE_PREDECESSOR',
  'SLICE_SCHEMA_PREDECESSOR',
  'SLICE_DEPENDENCY_FORWARD',
  'MIGRATION_CHAIN',
  // task state
  'TASK_STATE_SET',
  'TASK_TERMINAL_SET',
  'TASK_EVENT_SET',
  'TASK_OBLIGATION_SET',
  'TASK_TABLE_NOT_TOTAL',
  'TASK_TERMINAL_HAS_OUTGOING',
  'TASK_TARGET_CHOSEN_BY_CALLER',
  'TASK_SUCCESS_PRECONDITIONS',
  'TASK_ABANDONMENT_RULES',
  // evidence
  'EVIDENCE_CONTENT_FIELDS',
  'EVIDENCE_ORDERING',
  'EVIDENCE_TIEBREAK',
  'EVIDENCE_CONFLICT',
  // policy
  'POLICY_PARAMETER_MISMATCH',
  'INFRA_ATTEMPTS',
  // non-waivable
  'NON_WAIVABLE_SET',
  'NON_WAIVABLE_DEFAULT',
  'GATE_WAIVABLE',
  // decisions
  'DECISION_SET',
  'DECISION_STATE_MISMATCH',
  'DECISION_AMENDMENT_MISSING',
  'STANDING_AUTHORIZATION',
  // gates
  'GATE_ID_SET',
  'GATE_CONDITION_SET',
  'GATE_NOT_SEPARATE',
  'GATE_PHASE_LEAK',
  'GATE_G0_8_WEAK',
  'GATE_DECISION_REQUIREMENT',
  // triage
  'TRIAGE_ROW_COUNT',
  'TRIAGE_ROW_DUPLICATE',
  'TRIAGE_DISPOSITION_UNKNOWN',
  'TRIAGE_FIELD_MISSING',
  'TRIAGE_INVARIANT_UNKNOWN',
  'TRIAGE_CENSUS',
  'TRIAGE_SOURCE_HEAD',
  'TRIAGE_MAPPING_BASIS',
  'TRIAGE_SLICE_LOCAL_SET',
  'TRIAGE_SOURCE_FILE_COUNTS',
  // findings
  'FINDING_ID_SET',
  'FINDING_UNMAPPED',
  'FINDING_ROUND_ACCOUNTING',
  'DEBT_ID_SET',
  'DEBT_NOT_TESTABLE',
  'PR0_FINDING_SET',
  'PR0_VERDICT_MISMATCH',
  // PR #1
  'PR1_ORDERING_ALTERED',
  'PR1_FROZEN_HEAD',
  // boundary
  'RUNTIME_IMPORTS_SPEC',
  'RUNTIME_DYNAMIC_IMPORT',
  'BUILD_INCLUDES_TOOLS',
  // documents
  'DOC_INVARIANT_DRIFT',
  // the validator's own coverage
  'NEGATIVE_FIXTURE_MISSING',
  'NEGATIVE_FIXTURE_INERT',
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];

export interface Problem {
  code: FailureCode;
  detail: string;
}

export interface RunOptions {
  /** Inner runs skip fixture execution so the matrix cannot recurse into itself. */
  skipFixtureExecution?: boolean;
}

function push(out: Problem[], code: FailureCode, detail: string): void {
  out.push({ code, detail });
}

const sorted = (xs: readonly string[]): string => [...xs].sort().join(',');

// --- bundle integrity ----------------------------------------------------------------

export function checkBundle(b: SpecBundle, out: Problem[]): void {
  for (const p of b.loadProblems ?? []) {
    push(out, 'BUNDLE_LOAD', `${p.code}: ${p.detail}`);
  }
  for (const doc of A.REQUIRED_DOCS) {
    const text = b.docs[doc];
    if (text === undefined) push(out, 'DOC_MISSING', `spec/${doc}`);
    else if (text.trim().length === 0) push(out, 'DOC_EMPTY', `spec/${doc}`);
  }
  const present: Record<string, unknown> = {
    'invariants.json': b.invariants, 'action-matrix.json': b.actionMatrix,
    'slices.json': b.slices, 'test-triage.json': b.triage, 'findings.json': b.findings,
    'decisions.json': b.decisions, 'gates.json': b.gates, 'task-state.json': b.taskState,
    'evidence-model.json': b.evidenceModel, 'policy-parameters.json': b.policyParameters,
    'non-waivable.json': b.nonWaivable, 'pr1-ordering.json': b.pr1Ordering,
  };
  for (const name of A.REQUIRED_MANIFESTS) {
    const value = present[name];
    if (value === undefined || value === null || Object.keys(value as object).length === 0) {
      push(out, 'MANIFEST_MISSING', `spec/manifests/${name}`);
    }
  }
}

// --- invariants ------------------------------------------------------------------------

export function checkInvariants(b: SpecBundle, out: Problem[]): void {
  const list = b.invariants?.invariants ?? [];
  const ids = list.map((i) => i.id);

  if (sorted(ids) !== sorted(A.INVARIANT_IDS)) {
    push(out, 'INVARIANT_ID_SET', `manifest holds ${ids.length} ids; the anchor holds ${A.INVARIANT_IDS.length} and the sets differ`);
  }
  if (ids.length !== new Set(ids).size) {
    push(out, 'INVARIANT_ID_SET', 'duplicate invariant id');
  }
  const families = Object.keys(b.invariants?.families ?? {});
  if (sorted(families) !== sorted(Object.keys(A.FAMILY_NAMES))) {
    push(out, 'FAMILY_SET', `families are ${families.join(',')}`);
  }
  for (const [family, name] of Object.entries(A.FAMILY_NAMES)) {
    if (b.invariants?.families?.[family] !== name) {
      push(out, 'FAMILY_SET', `family ${family} is named "${String(b.invariants?.families?.[family])}", anchored as "${name}"`);
    }
  }
  for (const [family, members] of Object.entries(A.FAMILY_MEMBERSHIP)) {
    const actual = list.filter((i) => i.family === family).map((i) => i.id);
    if (sorted(actual) !== sorted(members)) {
      push(out, 'INVARIANT_FAMILY_MEMBERSHIP', `family ${family} holds ${actual.join(',')}`);
    }
  }

  const testNames = new Set<string>();
  for (const inv of list) {
    const o = inv.owners;
    const missing: string[] = [];
    if (!o || typeof o.normative !== 'string' || o.normative.length === 0) missing.push('normative');
    if (!o || !Array.isArray(o.enforcement) || o.enforcement.length === 0) missing.push('enforcement');
    if (!o || !Array.isArray(o.persistence) || o.persistence.length === 0) missing.push('persistence');
    if (!o || !Array.isArray(o.test) || o.test.length === 0) missing.push('test');
    if (missing.length > 0) push(out, 'OWNERSHIP_INCOMPLETE', `${inv.id} lacks ${missing.join(', ')}`);

    const isNa = Array.isArray(o?.persistence) && o.persistence.includes('n/a');
    if (isNa && !A.PERSISTENCE_NA_ALLOWED.includes(inv.id)) {
      push(out, 'PERSISTENCE_NA_NOT_PERMITTED', `${inv.id} claims n/a persistence, which the anchor permits only for ${A.PERSISTENCE_NA_ALLOWED.join(' and ')}`);
    }
    if (isNa && !o.persistence_note) {
      push(out, 'PERSISTENCE_NA_NOT_PERMITTED', `${inv.id} claims n/a persistence with no reason`);
    }
    if (!inv.introducing_slice || !Array.isArray(inv.inheriting_slices)) {
      push(out, 'SLICE_LINEAGE_MISSING', `${inv.id} lacks introducing or inheriting slices`);
    }

    const tests = inv.tests ?? [];
    if (!tests.some((t) => t.kind === 'positive' && t.name.length > 0)) {
      push(out, 'CONFORMANCE_TEST_MISSING', `${inv.id} names no positive conformance test`);
    }
    if (!tests.some((t) => t.kind === 'negative' && t.name.length > 0)) {
      push(out, 'NEGATIVE_TEST_MISSING', `${inv.id} names no negative test`);
    }
    for (const t of tests) {
      if (testNames.has(t.name)) push(out, 'TEST_NAME_DUPLICATE', t.name);
      testNames.add(t.name);
    }
  }

  const errata = new Map<string, string[]>();
  const decisions = new Map<string, string[]>();
  for (const inv of list) {
    for (const e of inv.errata ?? []) errata.set(e, [...(errata.get(e) ?? []), inv.id]);
    for (const d of inv.decisions ?? []) decisions.set(d, [...(decisions.get(d) ?? []), inv.id]);
  }
  for (const [fe, expected] of Object.entries(A.ERRATA_MAP)) {
    const actual = errata.get(fe) ?? [];
    if (sorted(actual) !== sorted(expected)) {
      push(out, 'ERRATA_MAP_MISMATCH', `${fe} maps to ${actual.join(',') || '(nothing)'}, anchored as ${expected.join(',')}`);
    }
  }
  for (const fe of errata.keys()) {
    if (!(fe in A.ERRATA_MAP)) {
      push(out, 'ERRATA_MAP_MISMATCH', `${fe} is mapped to invariants but is not an anchored erratum`);
    }
  }
  for (const fe of A.ERRATA_WITHOUT_INVARIANTS) {
    if (errata.has(fe)) {
      push(out, 'ERRATA_MAP_MISMATCH', `${fe} is a documentation-status erratum and must map to no invariant`);
    }
  }
  for (const [d, expected] of Object.entries(A.DECISION_INVARIANT_MAP)) {
    const actual = decisions.get(d) ?? [];
    if (sorted(actual) !== sorted(expected)) {
      push(out, 'DECISION_MAP_MISMATCH', `${d} maps to ${actual.join(',') || '(nothing)'}, anchored as ${expected.join(',')}`);
    }
  }
}

// --- action matrix ---------------------------------------------------------------------

function expectedCells(kind: string): Record<string, Disposition> {
  const anchor = A.ACTION_KINDS[kind];
  const cells: Record<string, Disposition> = {};
  for (const f of A.ALWAYS_REQUIRED_FIELDS) cells[f] = 'REQUIRED';
  if (!anchor) return cells;
  for (const f of anchor.extra_required) cells[f] = 'REQUIRED';
  for (const f of Object.keys(anchor.fixed)) cells[f] = 'FIXED';
  for (const f of anchor.optional) cells[f] = 'OPTIONAL';
  for (const f of anchor.forbidden) cells[f] = 'FORBIDDEN';
  return cells;
}

export function checkActionMatrix(b: SpecBundle, out: Problem[]): void {
  const m = b.actionMatrix;
  const kinds = Object.keys(m?.kinds ?? {});
  const anchorKinds = Object.keys(A.ACTION_KINDS);

  if (sorted(kinds) !== sorted(anchorKinds)) {
    push(out, 'MATRIX_KIND_SET', `manifest kinds are ${kinds.join(',')}`);
  }
  const fieldNames = (m?.fields ?? []).map((f) => f.name);
  if (sorted(fieldNames) !== sorted(A.ENVELOPE_FIELDS) || fieldNames.length !== A.ENVELOPE_FIELDS.length) {
    push(out, 'MATRIX_FIELD_SET', `manifest declares ${fieldNames.length} fields`);
  }
  if (sorted(m?.always_required ?? []) !== sorted(A.ALWAYS_REQUIRED_FIELDS)) {
    push(out, 'MATRIX_FIELD_SET', 'the always-required set does not match the anchor');
  }
  if (sorted((m?.dispositions ?? []) as string[]) !== sorted(A.DISPOSITIONS)) {
    push(out, 'MATRIX_DISPOSITION_SET', `dispositions are ${(m?.dispositions ?? []).join(',')}`);
  }

  let cells = 0;
  for (const kind of anchorKinds) {
    const spec = m?.kinds?.[kind];
    if (!spec) continue;
    const expected = expectedCells(kind);
    for (const field of A.ENVELOPE_FIELDS) {
      const actual = spec.fields?.[field];
      cells += 1;
      if (actual === undefined) {
        push(out, 'MATRIX_CELL_MISMATCH', `${kind}.${field} is not dispositioned`);
      } else if (actual !== expected[field]) {
        push(out, 'MATRIX_CELL_MISMATCH', `${kind}.${field} is ${actual}, anchored as ${String(expected[field])}`);
      }
    }
    for (const field of Object.keys(spec.fields ?? {})) {
      if (!A.ENVELOPE_FIELDS.includes(field)) {
        push(out, 'MATRIX_FIELD_SET', `${kind} dispositions unknown field ${field}`);
      }
    }
    const anchorFixed = A.ACTION_KINDS[kind]!.fixed;
    for (const [field, value] of Object.entries(anchorFixed)) {
      if (spec.fixed_values?.[field] !== value) {
        push(out, 'MATRIX_FIXED_VALUE', `${kind}.${field} fixed value is ${String(spec.fixed_values?.[field])}, anchored as ${value}`);
      }
    }
    for (const field of Object.keys(spec.fixed_values ?? {})) {
      if (!(field in anchorFixed)) {
        push(out, 'MATRIX_FIXED_VALUE', `${kind}.${field} carries a fixed value the anchor does not declare`);
      }
    }
    if (!spec.canonical_target?.startsWith(A.ACTION_KINDS[kind]!.target_scheme)) {
      push(out, 'MATRIX_TARGET_SCHEME', `${kind} target "${spec.canonical_target}" does not use the anchored scheme ${A.ACTION_KINDS[kind]!.target_scheme}`);
    }
    if (!A.IDENTITY_SCHEMES.some((s) => spec.canonical_target?.startsWith(s))) {
      push(out, 'MATRIX_TARGET_SCHEME', `${kind} target uses a scheme the identity chapter does not define`);
    }
  }

  const census = m?.census;
  if (!census || census.fields !== A.MATRIX_CENSUS.fields || census.action_kinds !== A.MATRIX_CENSUS.action_kinds
      || census.cells !== A.MATRIX_CENSUS.cells || census.always_required_fields !== A.MATRIX_CENSUS.always_required_fields
      || cells !== A.MATRIX_CENSUS.cells) {
    push(out, 'MATRIX_CENSUS', `declared ${JSON.stringify(census)}, counted ${cells} cells, anchored ${JSON.stringify(A.MATRIX_CENSUS)}`);
  }

  const group = (m?.field_groups ?? []).find((g) => g.name === 'git_provenance');
  if (!group) {
    push(out, 'MATRIX_GROUP_MISMATCH', 'the git_provenance group is absent');
  } else {
    if (sorted(group.members) !== sorted(A.GIT_PROVENANCE_GROUP.members)) {
      push(out, 'MATRIX_GROUP_MISMATCH', `group members are ${group.members.join(',')}`);
    }
    if (sorted(group.applies_to) !== sorted(A.GIT_PROVENANCE_GROUP.applies_to)) {
      push(out, 'MATRIX_GROUP_MISMATCH', `group applies to ${group.applies_to.join(',')}`);
    }
  }
  // Independently of what the manifest declares, no kind may permit an isolated head,
  // base or PR number.
  for (const kind of anchorKinds) {
    const f = m?.kinds?.[kind]?.fields;
    if (!f) continue;
    const inGroup = A.GIT_PROVENANCE_GROUP.applies_to.includes(kind);
    const anyBound = (['base_sha', 'head_sha', 'pr_number'] as const)
      .some((x) => f[x] === 'REQUIRED' || f[x] === 'OPTIONAL');
    if (!anyBound) continue;
    if (inGroup) {
      for (const member of A.GIT_PROVENANCE_GROUP.members) {
        if (f[member] !== 'OPTIONAL') {
          push(out, 'MATRIX_GROUP_MISMATCH', `${kind}.${member} is ${String(f[member])}; a grouped kind must leave every member OPTIONAL`);
        }
      }
    } else {
      for (const core of A.GIT_PROVENANCE_GROUP.core) {
        if (f[core] !== 'REQUIRED') {
          push(out, 'MATRIX_GROUP_MISMATCH', `${kind} permits provenance without requiring ${core}`);
        }
      }
    }
  }
}

// --- slices ------------------------------------------------------------------------------

export function checkSlices(b: SpecBundle, out: Problem[]): void {
  const m = b.slices;
  const order = m?.total_order ?? [];
  if (order.join(',') !== A.SLICE_ORDER.join(',')) {
    push(out, 'SLICE_ORDER_MISMATCH', `total order is ${order.join(' -> ')}`);
  }
  if ((m?.migration_chain ?? []).join(',') !== A.MIGRATION_CHAIN.join(',')) {
    push(out, 'MIGRATION_CHAIN', `declared chain is ${(m?.migration_chain ?? []).join(',')}`);
  }

  const byId = new Map((m?.slices ?? []).map((s) => [s.id, s]));
  A.SLICE_ORDER.forEach((id, index) => {
    const s = byId.get(id);
    if (!s) {
      push(out, 'SLICE_ORDER_MISMATCH', `${id} is absent from the manifest`);
      return;
    }
    if (s.position !== index + 1) {
      push(out, 'SLICE_ORDER_MISMATCH', `${id} declares position ${s.position}, anchored at ${index + 1}`);
    }
    const expectedMerge = index === 0 ? null : A.SLICE_ORDER[index - 1];
    if (s.merge_predecessor !== expectedMerge) {
      push(out, 'SLICE_MERGE_PREDECESSOR', `${id} names ${String(s.merge_predecessor)}, anchored as ${String(expectedMerge)}`);
    }
    if (s.migration !== A.SLICE_MIGRATION[id]) {
      push(out, 'MIGRATION_CHAIN', `${id} carries migration ${String(s.migration)}, anchored as ${String(A.SLICE_MIGRATION[id])}`);
    }
    for (const dep of s.functional_dependencies ?? []) {
      const at = A.SLICE_ORDER.indexOf(dep);
      if (at === -1 || at >= index) {
        push(out, 'SLICE_DEPENDENCY_FORWARD', `${id} depends on ${dep}`);
      }
    }
    let expectedSchema: string | null = null;
    for (let i = index - 1; i >= 0; i -= 1) {
      const migration = A.SLICE_MIGRATION[A.SLICE_ORDER[i] as string];
      if (migration) { expectedSchema = migration; break; }
    }
    if (id === 'PR-A') expectedSchema = null; // PR-A defines v1; it has no predecessor.
    if (s.schema_predecessor !== expectedSchema) {
      push(out, 'SLICE_SCHEMA_PREDECESSOR', `${id} names ${String(s.schema_predecessor)}, anchored as ${String(expectedSchema)}`);
    }
  });
}

// --- task state (D15) ---------------------------------------------------------------------

export function checkTaskState(b: SpecBundle, out: Problem[]): void {
  const t = b.taskState;
  if (!t || Object.keys(t).length === 0) return;

  if (sorted(t.states ?? []) !== sorted(A.TASK_STATES)) {
    push(out, 'TASK_STATE_SET', `states are ${(t.states ?? []).join(',')}`);
  }
  if (sorted(t.terminal_states ?? []) !== sorted(A.TERMINAL_STATES)) {
    push(out, 'TASK_TERMINAL_SET', `terminal states are ${(t.terminal_states ?? []).join(',')}`);
  }
  if (t.initial_state !== A.INITIAL_STATE) {
    push(out, 'TASK_STATE_SET', `initial state is ${String(t.initial_state)}`);
  }
  const events = (t.events ?? []).map((e) => e.name);
  if (sorted(events) !== sorted(A.TASK_EVENTS)) {
    push(out, 'TASK_EVENT_SET', `events are ${events.join(',')}`);
  }
  const covers = (t.events ?? []).map((e) => e.covers);
  for (const required of A.REQUIRED_EVENT_COVERAGE) {
    if (!covers.includes(required)) {
      push(out, 'TASK_EVENT_SET', `no event covers "${required}"`);
    }
  }
  if (sorted(t.obligations?.WAITING ?? []) !== sorted(A.WAITING_OBLIGATIONS)) {
    push(out, 'TASK_OBLIGATION_SET', `waiting obligations are ${(t.obligations?.WAITING ?? []).join(',')}`);
  }
  if (sorted(t.obligations?.BLOCKED ?? []) !== sorted(A.BLOCKED_OBLIGATIONS)) {
    push(out, 'TASK_OBLIGATION_SET', `blocked obligations are ${(t.obligations?.BLOCKED ?? []).join(',')}`);
  }

  const seen = new Set<string>();
  for (const tr of t.transitions ?? []) {
    const key = `${tr.event}|${tr.from}`;
    if (seen.has(key)) push(out, 'TASK_TABLE_NOT_TOTAL', `duplicate cell ${key}`);
    seen.add(key);
    if (tr.decision !== 'ALLOWED' && tr.decision !== 'REFUSED') {
      push(out, 'TASK_TABLE_NOT_TOTAL', `${key} carries decision ${String(tr.decision)}`);
    }
    if (tr.decision === 'REFUSED' && !tr.reason) {
      push(out, 'TASK_TABLE_NOT_TOTAL', `${key} is refused with no reason`);
    }
    if (tr.decision === 'ALLOWED' && !tr.target_rule) {
      push(out, 'TASK_TABLE_NOT_TOTAL', `${key} is allowed with no target rule`);
    }
    if (A.TERMINAL_STATES.includes(tr.from) && tr.decision === 'ALLOWED') {
      push(out, 'TASK_TERMINAL_HAS_OUTGOING', `${tr.from} permits ${tr.event}`);
    }
  }
  for (const event of A.TASK_EVENTS) {
    for (const state of A.TASK_STATES) {
      if (!seen.has(`${event}|${state}`)) {
        push(out, 'TASK_TABLE_NOT_TOTAL', `no explicit decision for (${state}, ${event})`);
      }
    }
  }
  if ((t.transitions ?? []).length !== A.TASK_STATE_CENSUS.pairs) {
    push(out, 'TASK_TABLE_NOT_TOTAL', `${(t.transitions ?? []).length} cells, anchored at ${A.TASK_STATE_CENSUS.pairs}`);
  }

  const never = t.caller_contract?.never_submits ?? [];
  if (!never.some((x) => /target state/i.test(x))) {
    push(out, 'TASK_TARGET_CHOSEN_BY_CALLER', 'the caller contract does not forbid submitting a target state');
  }
  if ((t.success_preconditions ?? []).length !== A.SUCCESS_PRECONDITION_COUNT) {
    push(out, 'TASK_SUCCESS_PRECONDITIONS', `${(t.success_preconditions ?? []).length} preconditions, anchored at ${A.SUCCESS_PRECONDITION_COUNT}`);
  }
  const preconditionText = (t.success_preconditions ?? []).join(' ');
  for (const required of ['obligation', 'CI', 'lease', 'UNKNOWN_PENDING_RECONCILIATION', 'ABANDONED_BY_DECISION']) {
    if (!preconditionText.includes(required)) {
      push(out, 'TASK_SUCCESS_PRECONDITIONS', `no success precondition mentions ${required}`);
    }
  }
  if ((t.abandonment_rules ?? []).length !== A.ABANDONMENT_RULE_COUNT) {
    push(out, 'TASK_ABANDONMENT_RULES', `${(t.abandonment_rules ?? []).length} rules, anchored at ${A.ABANDONMENT_RULE_COUNT}`);
  }
  const abandonText = (t.abandonment_rules ?? []).join(' ');
  for (const required of ['obligation', 'dependency', 'G0-8']) {
    if (!abandonText.includes(required)) {
      push(out, 'TASK_ABANDONMENT_RULES', `the abandonment rules do not cover ${required}`);
    }
  }
}

// --- evidence (D17) -------------------------------------------------------------------------

export function checkEvidenceModel(b: SpecBundle, out: Problem[]): void {
  const e = b.evidenceModel;
  if (!e || Object.keys(e).length === 0) return;
  const fields = (e.content_fields ?? []).map((f) => f.name);
  if (sorted(fields) !== sorted(A.EVIDENCE_CONTENT_FIELDS)) {
    push(out, 'EVIDENCE_CONTENT_FIELDS', `content fields are ${fields.join(',')}`);
  }
  if (e.ordering?.authoritative !== A.EVIDENCE_ORDERING_FIELD) {
    push(out, 'EVIDENCE_ORDERING', `ordering is by ${String(e.ordering?.authoritative)}, anchored as ${A.EVIDENCE_ORDERING_FIELD}`);
  }
  if (sorted(e.ordering?.forbidden_tiebreaks ?? []) !== sorted(A.EVIDENCE_FORBIDDEN_TIEBREAKS)) {
    push(out, 'EVIDENCE_TIEBREAK', `forbidden tie-breaks are ${(e.ordering?.forbidden_tiebreaks ?? []).join(',')}`);
  }
  const conflict = e.conflict ?? {};
  if (!/IDEMPOTENT_DUPLICATE/.test(conflict['same_generation_same_digest'] ?? '')) {
    push(out, 'EVIDENCE_CONFLICT', 'an identical redelivery is not declared an idempotent duplicate');
  }
  if (!/CONFLICTED/.test(conflict['same_generation_different_digest'] ?? '')) {
    push(out, 'EVIDENCE_CONFLICT', 'two digests at one generation do not make the slot conflicted');
  }
  if (!/CONFLICTED/.test(conflict['no_maximal_generation'] ?? '')) {
    push(out, 'EVIDENCE_CONFLICT', 'the absence of a greatest generation does not fail the slot closed');
  }
}

// --- policy parameters (D16, D18) --------------------------------------------------------------

export function checkPolicyParameters(b: SpecBundle, out: Problem[]): void {
  const p = b.policyParameters;
  if (!p || Object.keys(p).length === 0) return;
  const byKey = new Map((p.parameters ?? []).map((x) => [x.key, x]));
  for (const [key, anchor] of Object.entries(A.POLICY_PARAMETERS)) {
    const actual = byKey.get(key);
    if (!actual) {
      push(out, 'POLICY_PARAMETER_MISMATCH', `${key} is absent`);
      continue;
    }
    if (actual.value !== anchor.value || actual.maximum !== anchor.maximum || actual.waivable !== anchor.waivable) {
      push(out, 'POLICY_PARAMETER_MISMATCH', `${key} is ${JSON.stringify({ value: actual.value, maximum: actual.maximum, waivable: actual.waivable })}, anchored ${JSON.stringify(anchor)}`);
    }
    if (!Number.isSafeInteger(actual.maximum) || actual.maximum > Number.MAX_SAFE_INTEGER / 2) {
      push(out, 'POLICY_PARAMETER_MISMATCH', `${key} has no meaningful finite maximum`);
    }
  }
  const retry = p.infrastructure_retry ?? {};
  if (retry['attempts'] !== A.INFRASTRUCTURE_ATTEMPTS) {
    push(out, 'INFRA_ATTEMPTS', `attempts is ${String(retry['attempts'])}, anchored at ${A.INFRASTRUCTURE_ATTEMPTS}`);
  }
  for (const key of ['retry_precondition', 'concurrency', 'attempt_identity', 'on_exhaustion', 'budget', 'unknown_effects_excluded']) {
    if (!retry[key]) push(out, 'INFRA_ATTEMPTS', `the retry rule does not state ${key}`);
  }
}

// --- non-waivable (D18) -------------------------------------------------------------------------

export function checkNonWaivable(b: SpecBundle, out: Problem[]): void {
  const n = b.nonWaivable;
  if (!n || Object.keys(n).length === 0) return;
  const ids = (n.non_waivable ?? []).map((x) => x.id);
  if (sorted(ids) !== sorted(A.NON_WAIVABLE_IDS)) {
    push(out, 'NON_WAIVABLE_SET', `non-waivable ids are ${ids.join(',')}`);
  }
  const subjects = (n.non_waivable ?? []).map((x) => x.subject).join(' | ');
  for (const keyword of A.NON_WAIVABLE_SUBJECT_KEYWORDS) {
    if (!subjects.includes(keyword)) {
      push(out, 'NON_WAIVABLE_SET', `no non-waivable subject mentions "${keyword}"`);
    }
  }
  if (!/never permission|not permission/i.test(n.waivable_targets?.default ?? '')) {
    push(out, 'NON_WAIVABLE_DEFAULT', 'unmarked policies are not declared non-waivable by default');
  }
  for (const gate of b.gates?.gates ?? []) {
    if (A.GATES_NON_WAIVABLE.includes(gate.id) && gate.waivable !== false) {
      push(out, 'GATE_WAIVABLE', `${gate.id} is not marked non-waivable`);
    }
  }
}

// --- decisions ----------------------------------------------------------------------------------

export function checkDecisions(b: SpecBundle, out: Problem[]): void {
  const m = b.decisions;
  const rows = m?.decisions ?? [];
  const ids = rows.map((d) => d.id);
  const anchorIds = Object.keys(A.DECISION_STATES);
  if (sorted(ids) !== sorted(anchorIds)) {
    push(out, 'DECISION_SET', `ledger holds ${ids.join(',')}`);
  }
  if (sorted(m?.legal_states ?? []) !== sorted(A.LEGAL_DECISION_STATES)) {
    push(out, 'DECISION_STATE_MISMATCH', `legal states are ${(m?.legal_states ?? []).join(',')}`);
  }
  for (const row of rows) {
    const expected = A.DECISION_STATES[row.id];
    if (expected === undefined) continue;
    if (row.state !== expected) {
      push(out, 'DECISION_STATE_MISMATCH', `${row.id} is ${row.state}, anchored as ${expected}`);
    }
  }
  for (const id of A.AMENDED_DECISIONS) {
    const row = rows.find((d) => d.id === id);
    if (row && (!Array.isArray(row.amended_by))) {
      push(out, 'DECISION_AMENDMENT_MISSING', `${id} has no amendment list`);
    }
  }
  const standing = new Map((m?.standing_authorizations ?? []).map((s) => [s.subject, s.state]));
  for (const subject of A.STANDING_NOT_AUTHORIZED) {
    if (standing.get(subject) !== 'NOT_AUTHORIZED') {
      push(out, 'STANDING_AUTHORIZATION', `"${subject}" is ${String(standing.get(subject))}, anchored as NOT_AUTHORIZED`);
    }
  }
}

// --- gates -----------------------------------------------------------------------------------------

export function checkGates(b: SpecBundle, out: Problem[]): void {
  const gates = b.gates?.gates ?? [];
  const ids = gates.map((g) => g.id);
  if (sorted(ids) !== sorted(A.GATES_NON_WAIVABLE)) {
    push(out, 'GATE_ID_SET', `gates are ${ids.join(',')}`);
    return;
  }
  const phase0 = gates.find((g) => g.id === 'phase0_completion');
  const phase1a = gates.find((g) => g.id === 'phase1a_entry');
  if (!phase0 || !phase1a) return;

  const p0 = phase0.conditions.map((c) => c.id);
  const p1 = phase1a.conditions.map((c) => c.id);
  if (sorted(p0) !== sorted(A.PHASE0_CONDITIONS)) {
    push(out, 'GATE_CONDITION_SET', `Phase 0 conditions are ${p0.join(',')}`);
  }
  if (sorted(p1) !== sorted(A.PHASE1A_CONDITIONS)) {
    push(out, 'GATE_CONDITION_SET', `Phase 1A conditions are ${p1.join(',')}`);
  }
  for (const id of p1) {
    if (p0.includes(id)) push(out, 'GATE_NOT_SEPARATE', `condition ${id} appears in both gates`);
  }
  for (const c of phase0.conditions) {
    if (/\bD13\b|\bD14\b/.test(c.text)) {
      push(out, 'GATE_PHASE_LEAK', `Phase 0 condition ${c.id} depends on a deferred Phase 1A decision`);
    }
  }

  const g08 = phase0.conditions.find((c) => c.id === 'G0-8');
  if (!g08) {
    push(out, 'GATE_G0_8_WEAK', 'G0-8 is absent');
  } else {
    if (sorted(g08.rejects ?? []) !== sorted(A.G0_8_REJECTS)) {
      push(out, 'GATE_G0_8_WEAK', `G0-8 rejects ${(g08.rejects ?? []).join(',')}, anchored as ${A.G0_8_REJECTS.join(',')}`);
    }
    for (const term of A.G0_8_REJECTS) {
      if (!g08.text.includes(term.split('=')[0] as string)) {
        push(out, 'GATE_G0_8_WEAK', `G0-8's text does not exclude ${term}`);
      }
    }
  }

  for (const [conditionId, decisionId] of Object.entries(A.PHASE1A_DECISION_REQUIREMENTS)) {
    const c = phase1a.conditions.find((x) => x.id === conditionId);
    const req = c?.requires_decision;
    if (!req) {
      push(out, 'GATE_DECISION_REQUIREMENT', `${conditionId} consumes no decision`);
      continue;
    }
    if (req.decision_id !== decisionId) {
      push(out, 'GATE_DECISION_REQUIREMENT', `${conditionId} names ${req.decision_id}, anchored as ${decisionId}`);
    }
    if (req.outcome !== 'APPROVED' || !req.requires_content_ref || !req.requires_content_version || !req.evaluate_consequence) {
      push(out, 'GATE_DECISION_REQUIREMENT', `${conditionId} is satisfied by the presence of a decision rather than by an approved resolution with content, version and consequence`);
    }
  }
}

// --- triage ------------------------------------------------------------------------------------------

export function checkTriage(b: SpecBundle, out: Problem[]): void {
  const m = b.triage;
  const rows = m?.rows ?? [];
  const known = new Set(A.INVARIANT_IDS);

  if (rows.length !== A.TRIAGE_CENSUS.rows) {
    push(out, 'TRIAGE_ROW_COUNT', `${rows.length} rows, anchored at ${A.TRIAGE_CENSUS.rows}`);
  }
  const seen = new Set<number>();
  const tally = { KEEP: 0, REWRITE: 0, DROP: 0 };
  const perFile = new Map<string, number>();
  const sliceLocal: number[] = [];

  for (const r of rows) {
    if (seen.has(r.row)) push(out, 'TRIAGE_ROW_DUPLICATE', `row ${r.row}`);
    seen.add(r.row);
    if (r.disposition !== 'KEEP' && r.disposition !== 'REWRITE' && r.disposition !== 'DROP') {
      push(out, 'TRIAGE_DISPOSITION_UNKNOWN', `row ${r.row}: ${String(r.disposition)}`);
      continue;
    }
    tally[r.disposition] += 1;
    perFile.set(r.source_file, (perFile.get(r.source_file) ?? 0) + 1);

    if (!r.source_file || !r.scenario || !r.rationale) {
      push(out, 'TRIAGE_FIELD_MISSING', `row ${r.row} lacks a source file, scenario or rationale`);
    }
    if (r.source_head !== A.FROZEN_PR1_HEAD) {
      push(out, 'TRIAGE_SOURCE_HEAD', `row ${r.row} names ${r.source_head}`);
    }
    if (!A.TRIAGE_MAPPING_BASES.includes(r.mapping_basis)) {
      push(out, 'TRIAGE_MAPPING_BASIS', `row ${r.row} has basis ${String(r.mapping_basis)}`);
    } else if (r.mapping_basis === 'invariant') {
      if ((r.invariants ?? []).length === 0) {
        push(out, 'TRIAGE_FIELD_MISSING', `row ${r.row} claims an invariant basis and names none`);
      }
      if (r.slice_local !== null) {
        push(out, 'TRIAGE_MAPPING_BASIS', `row ${r.row} claims an invariant basis and carries slice-local detail`);
      }
    } else {
      sliceLocal.push(r.row);
      if ((r.invariants ?? []).length > 0) {
        push(out, 'TRIAGE_MAPPING_BASIS', `row ${r.row} is slice-local yet maps to an invariant`);
      }
      const sl = r.slice_local;
      if (!sl || !sl.owner_slice || !sl.named_test || !sl.why_no_invariant) {
        push(out, 'TRIAGE_MAPPING_BASIS', `row ${r.row} is slice-local without an owner, a named test and a reason`);
      }
    }
    for (const id of r.invariants ?? []) {
      if (!known.has(id)) push(out, 'TRIAGE_INVARIANT_UNKNOWN', `row ${r.row}: ${id}`);
    }
    if (r.disposition === 'REWRITE' && (!r.target_slice || !r.replacement)) {
      push(out, 'TRIAGE_FIELD_MISSING', `row ${r.row} is REWRITE without a target slice and replacement name`);
    }
    if (r.disposition === 'KEEP' && !r.target_slice) {
      push(out, 'TRIAGE_FIELD_MISSING', `row ${r.row} is KEEP without a target slice`);
    }
    if (r.disposition === 'DROP' && r.replacement) {
      push(out, 'TRIAGE_FIELD_MISSING', `row ${r.row} is DROP but names a replacement`);
    }
  }
  for (let i = 1; i <= A.TRIAGE_CENSUS.rows; i += 1) {
    if (!seen.has(i)) push(out, 'TRIAGE_ROW_COUNT', `row ${i} is missing`);
  }
  if (m?.census?.rows !== rows.length || m.census.KEEP !== tally.KEEP
      || m.census.REWRITE !== tally.REWRITE || m.census.DROP !== tally.DROP
      || tally.KEEP !== A.TRIAGE_CENSUS.KEEP || tally.REWRITE !== A.TRIAGE_CENSUS.REWRITE
      || tally.DROP !== A.TRIAGE_CENSUS.DROP) {
    push(out, 'TRIAGE_CENSUS', `counted ${JSON.stringify(tally)}, anchored ${JSON.stringify(A.TRIAGE_CENSUS)}`);
  }
  if (sliceLocal.sort((x, y) => x - y).join(',') !== [...A.TRIAGE_SLICE_LOCAL_ROWS].join(',')) {
    push(out, 'TRIAGE_SLICE_LOCAL_SET', `slice-local rows are ${sliceLocal.join(',')}, anchored as ${A.TRIAGE_SLICE_LOCAL_ROWS.join(',')}`);
  }
  for (const [file, count] of Object.entries(A.TRIAGE_SOURCE_FILES)) {
    if ((perFile.get(file) ?? 0) !== count) {
      push(out, 'TRIAGE_SOURCE_FILE_COUNTS', `${file} contributes ${perFile.get(file) ?? 0} rows, anchored at ${count}`);
    }
  }
  for (const file of perFile.keys()) {
    if (!(file in A.TRIAGE_SOURCE_FILES)) {
      push(out, 'TRIAGE_SOURCE_FILE_COUNTS', `${file} is not an anchored source file`);
    }
  }
}

// --- findings ------------------------------------------------------------------------------------------

export function checkFindings(b: SpecBundle, out: Problem[]): void {
  const m = b.findings;
  const known = new Set(A.INVARIANT_IDS);
  const dispositions = ['FIX', 'ACCEPT', 'DEFER'];

  const ids = (m?.findings ?? []).map((f) => f.id);
  if (sorted(ids) !== sorted(A.PR1_FINDING_IDS)) {
    push(out, 'FINDING_ID_SET', `the PR #1 finding set is ${ids.length} entries and differs from the anchored ${A.PR1_FINDING_IDS.length}`);
  }
  const rounds = (m?.rounds ?? []).map((r) => r.round);
  if (sorted(rounds.map(String)) !== sorted(A.PR1_ROUNDS.map(String))) {
    push(out, 'FINDING_ROUND_ACCOUNTING', `rounds are ${rounds.join(',')}`);
  }
  for (const f of m?.findings ?? []) {
    if ((f.invariants ?? []).length === 0) push(out, 'FINDING_UNMAPPED', `${f.id} maps to no invariant`);
    for (const id of f.invariants ?? []) {
      if (!known.has(id)) push(out, 'FINDING_UNMAPPED', `${f.id} names unknown ${id}`);
    }
    if (!dispositions.includes(f.disposition)) push(out, 'FINDING_UNMAPPED', `${f.id} has disposition ${f.disposition}`);
  }
  const debtIds = (m?.carried_debt ?? []).map((d) => d.id);
  if (sorted(debtIds) !== sorted(A.DEBT_IDS)) {
    push(out, 'DEBT_ID_SET', `debt items are ${debtIds.join(',')}`);
  }
  for (const round of m?.rounds ?? []) {
    const actual = (m?.findings ?? []).filter((f) => f.round === round.round).length;
    if (actual !== round.itemised) {
      push(out, 'FINDING_ROUND_ACCOUNTING', `round ${round.round} declares ${round.itemised} itemised, holds ${actual}`);
    }
    const total = Object.values(round.aggregate ?? {}).reduce((a, c) => a + c, 0);
    if (round.itemised + round.unitemised !== total) {
      push(out, 'FINDING_ROUND_ACCOUNTING', `round ${round.round}: ${round.itemised} + ${round.unitemised} does not equal the verdict total ${total}`);
    }
    if (round.unitemised > 0 && (round.unitemised_debt === null || !debtIds.includes(round.unitemised_debt))) {
      push(out, 'FINDING_ROUND_ACCOUNTING', `round ${round.round} leaves ${round.unitemised} findings unaccounted for`);
    }
  }
  for (const d of m?.carried_debt ?? []) {
    if ((d.invariants ?? []).length === 0) push(out, 'DEBT_ID_SET', `${d.id} maps to no invariant`);
    if (!dispositions.includes(d.disposition) || !d.owner || !d.target) {
      push(out, 'DEBT_ID_SET', `${d.id} lacks a disposition, owner or target`);
    }
    if (d.id === 'DEBT-2' && (!d.rule || !d.exit_condition)) {
      push(out, 'DEBT_NOT_TESTABLE', 'DEBT-2 must state a testable rule and an exit condition, not defer its own answer');
    }
  }

  const pr0 = m?.pr0_review;
  const pr0Ids = (pr0?.findings ?? []).map((f) => f.id);
  if (sorted(pr0Ids) !== sorted(A.PR0_ROUND1_FINDING_IDS)) {
    push(out, 'PR0_FINDING_SET', `PR-0 round 1 holds ${pr0Ids.length} findings, anchored at ${A.PR0_ROUND1_FINDING_IDS.length}`);
  }
  for (const f of pr0?.findings ?? []) {
    if ((f.invariants ?? []).length === 0) push(out, 'PR0_FINDING_SET', `${f.id} maps to no invariant`);
    for (const id of f.invariants ?? []) {
      if (!known.has(id)) push(out, 'PR0_FINDING_SET', `${f.id} names unknown ${id}`);
    }
    if (!f.closure || !f.closed_by) push(out, 'PR0_FINDING_SET', `${f.id} records no closure`);
  }
  const round1 = (pr0?.rounds ?? []).find((r) => r.round === 1);
  const verdict = round1?.verdict;
  const anchored = A.PR0_ROUND1_VERDICT;
  if (!verdict || verdict['blocker'] !== anchored.blocker || verdict['high'] !== anchored.high
      || verdict['medium'] !== anchored.medium || verdict['low'] !== anchored.low) {
    push(out, 'PR0_VERDICT_MISMATCH', `round 1 verdict is ${JSON.stringify(verdict)}, anchored ${JSON.stringify(anchored)}`);
  }
  const totalVerdict = anchored.blocker + anchored.high + anchored.medium + anchored.low;
  if (round1 && round1.itemised !== totalVerdict) {
    push(out, 'PR0_VERDICT_MISMATCH', `round 1 itemises ${round1.itemised} of ${totalVerdict} findings`);
  }
  if (pr0 && pr0.reviewed_base !== A.PR0_REVIEWED_BASE) {
    push(out, 'PR0_VERDICT_MISMATCH', `reviewed base is ${pr0.reviewed_base}`);
  }
  if (round1 && round1.head !== A.PR0_ROUND1_HEAD) {
    push(out, 'PR0_VERDICT_MISMATCH', `round 1 head is ${round1.head}`);
  }
}

// --- PR #1 ordering ------------------------------------------------------------------------------------

export function checkPr1Ordering(b: SpecBundle, out: Problem[]): void {
  const m = b.pr1Ordering;
  if (!m || Object.keys(m).length === 0) return;
  const steps = (m.steps ?? []).slice().sort((x, y) => x.step - y.step);
  if (steps.length !== A.PR1_ORDERING_STEPS.length) {
    push(out, 'PR1_ORDERING_ALTERED', `${steps.length} steps, anchored at ${A.PR1_ORDERING_STEPS.length}`);
  }
  A.PR1_ORDERING_STEPS.forEach((expected, index) => {
    const actual = steps[index];
    if (!actual) {
      push(out, 'PR1_ORDERING_ALTERED', `step ${index + 1} is missing`);
      return;
    }
    if (actual.step !== index + 1) {
      push(out, 'PR1_ORDERING_ALTERED', `step at position ${index + 1} is numbered ${actual.step}`);
    }
    if (actual.action !== expected) {
      push(out, 'PR1_ORDERING_ALTERED', `step ${index + 1} is "${actual.action}", anchored as "${expected}"`);
    }
  });
  if (m.reordering_permitted !== false) {
    push(out, 'PR1_ORDERING_ALTERED', 'the manifest permits reordering');
  }
  if (m.pr1?.frozen_head !== A.FROZEN_PR1_HEAD) {
    push(out, 'PR1_FROZEN_HEAD', `frozen head is ${String(m.pr1?.frozen_head)}`);
  }
  if (!(b.docs['11-pr1-disposition.md'] ?? '').includes(A.FROZEN_PR1_HEAD)) {
    push(out, 'PR1_FROZEN_HEAD', 'the disposition document does not record the frozen head');
  }
}

// --- the runtime boundary ------------------------------------------------------------------------------

/** Strips line and block comments so a mention inside a comment proves nothing. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

export function checkRuntimeBoundary(b: SpecBundle, out: Problem[]): void {
  const staticImport = /(?:^|\s)(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g;
  const bareImport = /(?:^|\s)import\s*['"]([^'"]+)['"]/g;
  const literalDynamic = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const literalRequire = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const computedDynamic = /\bimport\s*\(\s*(?!['"])/g;
  const computedRequire = /\brequire\s*\(\s*(?!['"])/g;
  // An aliased require factory hides the call site entirely, so its mere presence is
  // unresolvable by any static reading.
  const requireFactory = /\bcreateRequire\s*\(/g;

  const forbidden = (specifier: string): boolean =>
    A.FORBIDDEN_RUNTIME_TARGETS.some((target) => specifier.includes(target));

  for (const file of b.runtimeFiles ?? []) {
    const source = stripComments(file.content);
    for (const pattern of [staticImport, bareImport, literalDynamic, literalRequire]) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        const specifier = match[1] ?? '';
        if (forbidden(specifier)) {
          push(out, 'RUNTIME_IMPORTS_SPEC', `${file.path} loads ${specifier}`);
        }
      }
    }
    for (const pattern of [computedDynamic, computedRequire, requireFactory]) {
      pattern.lastIndex = 0;
      if (pattern.test(source) && !A.DYNAMIC_IMPORT_ALLOWLIST.includes(file.path)) {
        push(out, 'RUNTIME_DYNAMIC_IMPORT', `${file.path} loads a module by a specifier this checker cannot resolve, and is not on the allowlist`);
      }
    }
  }

  const build = b.configs?.['tsconfig.build.json'] ?? '';
  if (build.includes('tools/')) {
    push(out, 'BUILD_INCLUDES_TOOLS', 'tsconfig.build.json pulls tools/ into the runtime build');
  }
  const pkg = b.configs?.['package.json'] ?? '';
  let parsed: Record<string, unknown> = {};
  try {
    parsed = pkg ? (JSON.parse(pkg) as Record<string, unknown>) : {};
  } catch {
    push(out, 'BUILD_INCLUDES_TOOLS', 'package.json does not parse, so the export boundary cannot be proved');
    return;
  }
  const entryPoints = JSON.stringify({ main: parsed['main'], exports: parsed['exports'], bin: parsed['bin'], files: parsed['files'] });
  if (entryPoints.includes('tools/')) {
    push(out, 'BUILD_INCLUDES_TOOLS', 'a package entry point resolves into tools/');
  }
}

// --- document drift --------------------------------------------------------------------------------------

export function checkDocDrift(b: SpecBundle, out: Problem[]): void {
  const onDisk = b.docs['01-invariants.md'] ?? '';
  if (onDisk.trim().length === 0) return; // already reported by checkBundle
  if (renderInvariants(b.invariants).trim() !== onDisk.trim()) {
    push(out, 'DOC_INVARIANT_DRIFT', 'spec/01-invariants.md does not match a fresh render of invariants.json');
  }
}

// --- fixture coverage, proved by execution -----------------------------------------------------------------

export function checkNegativeFixtures(
  b: SpecBundle,
  out: Problem[],
  registry?: { fixtures: { code: FailureCode; why: string; mutate: (b: SpecBundle) => void }[] },
): void {
  const { fixtures } = registry ?? fixtureModule();
  const covered = new Set(fixtures.map((f) => f.code));
  for (const code of FAILURE_CODES) {
    if (A.FIXTURE_EXEMPT_CODES.includes(code)) continue;
    if (!covered.has(code)) push(out, 'NEGATIVE_FIXTURE_MISSING', `${code} has no fixture`);
  }
  for (const fixture of fixtures) {
    const mutated = structuredClone(b);
    fixture.mutate(mutated);
    const codes = runChecks(mutated, { skipFixtureExecution: true }).map((p) => p.code);
    if (!codes.includes(fixture.code)) {
      push(out, 'NEGATIVE_FIXTURE_INERT', `the fixture "${fixture.why}" does not provoke ${fixture.code}`);
    }
  }
  const declared = FAILURE_CODES.length;
  const fixtureCount = fixtures.length;
  if (registry === undefined
      && (A.CENSUS_CURRENT.failure_codes !== declared || A.CENSUS_CURRENT.fixtures !== fixtureCount)) {
    push(out, 'NEGATIVE_FIXTURE_MISSING', `census is ${fixtureCount} fixtures over ${declared} codes, anchored as ${A.CENSUS_CURRENT.fixtures} over ${A.CENSUS_CURRENT.failure_codes}`);
  }
}

// Set by fixtures.ts at import time; kept out of the static graph so checks.ts does not
// import a module that imports it back.
let fixtureRegistry: { fixtures: { code: FailureCode; why: string; mutate: (b: SpecBundle) => void }[] } | null = null;

export function registerFixtures(registry: { fixtures: { code: FailureCode; why: string; mutate: (b: SpecBundle) => void }[] }): void {
  fixtureRegistry = registry;
}

function fixtureModule(): { fixtures: { code: FailureCode; why: string; mutate: (b: SpecBundle) => void }[] } {
  return fixtureRegistry ?? { fixtures: [] };
}

// --- the run -------------------------------------------------------------------------------------------------

export function runChecks(b: SpecBundle, options: RunOptions = {}): Problem[] {
  const out: Problem[] = [];
  checkBundle(b, out);
  checkInvariants(b, out);
  checkActionMatrix(b, out);
  checkSlices(b, out);
  checkTaskState(b, out);
  checkEvidenceModel(b, out);
  checkPolicyParameters(b, out);
  checkNonWaivable(b, out);
  checkDecisions(b, out);
  checkGates(b, out);
  checkTriage(b, out);
  checkFindings(b, out);
  checkPr1Ordering(b, out);
  checkRuntimeBoundary(b, out);
  checkDocDrift(b, out);
  if (!options.skipFixtureExecution) checkNegativeFixtures(b, out);
  return out;
}
