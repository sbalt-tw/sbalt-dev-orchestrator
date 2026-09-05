// Mechanical checks over the specification bundle. Every check returns problems as
// coded findings so a negative fixture can assert the exact failure it provoked.

import type { SpecBundle, Disposition } from './types.js';
import { renderInvariants } from './render.js';

export const FAILURE_CODES = [
  'INVARIANT_CENSUS',
  'FAMILY_CENSUS',
  'INVARIANT_ID_SHAPE',
  'INVARIANT_ID_DUPLICATE',
  'INVARIANT_FAMILY_SERIES',
  'OWNERSHIP_INCOMPLETE',
  'SLICE_LINEAGE_MISSING',
  'CONFORMANCE_TEST_MISSING',
  'NEGATIVE_TEST_MISSING',
  'TEST_NAME_DUPLICATE',
  'ERRATA_UNMAPPED',
  'MATRIX_NOT_TOTAL',
  'MATRIX_BAD_DISPOSITION',
  'MATRIX_ALWAYS_REQUIRED',
  'MATRIX_FIXED_WITHOUT_VALUE',
  'MATRIX_GROUP_INCONSISTENT',
  'MATRIX_ISOLATED_PROVENANCE',
  'MATRIX_TARGET_SCHEME_UNKNOWN',
  'SLICE_ORDER_CYCLE',
  'SLICE_MERGE_PREDECESSOR',
  'SLICE_SCHEMA_PREDECESSOR',
  'MIGRATION_CHAIN',
  'TRIAGE_ROW_COUNT',
  'TRIAGE_ROW_DUPLICATE',
  'TRIAGE_DISPOSITION_UNKNOWN',
  'TRIAGE_FIELD_MISSING',
  'TRIAGE_INVARIANT_UNKNOWN',
  'TRIAGE_CENSUS',
  'TRIAGE_SOURCE_HEAD',
  'FINDING_UNMAPPED',
  'FINDING_ROUND_ACCOUNTING',
  'DEBT_UNMAPPED',
  'DECISION_SET',
  'DECISION_STATE_ILLEGAL',
  'GATE_NOT_SEPARATE',
  'GATE_PHASE_LEAK',
  'PR1_ORDERING_ALTERED',
  'RUNTIME_IMPORTS_SPEC',
  'BUILD_INCLUDES_TOOLS',
  'DOC_INVARIANT_DRIFT',
  'NEGATIVE_FIXTURE_MISSING',
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];

export interface Problem {
  code: FailureCode;
  detail: string;
}

const EXPECTED_INVARIANTS = 47;
const EXPECTED_FAMILIES = 8;
const EXPECTED_TRIAGE_ROWS = 141;
const EXPECTED_MIGRATIONS = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'];
const FROZEN_PR1_HEAD = '428ae75e91fa1dd23c371d5f7af745aba0bec7fd';
const ERRATA = ['FE-1', 'FE-2', 'FE-3', 'FE-4', 'FE-5', 'FE-6', 'FE-7', 'FE-8'];
const IDENTITY_SCHEMES = ['git:', 'env:', 'resource:', 'policy:', 'finding:'];
const PR1_STEPS = [
  'Plan v2.2 delivered',
  'Founder approves D1–D10 and authorises D11',
  'PR-0 opens',
  'PR-0 reviewed at its exact head, findings resolved, merged',
  'Founder **separately** authorises closing PR #1',
  'PR #1 closed unmerged with a superseded note',
  'Only then may PR-A open',
];

function push(out: Problem[], code: FailureCode, detail: string): void {
  out.push({ code, detail });
}

// --- 1-6, 11: the invariant manifest ------------------------------------------------

export function checkInvariants(b: SpecBundle, out: Problem[]): void {
  const m = b.invariants;
  const list = m.invariants;

  if (list.length !== EXPECTED_INVARIANTS || m.census.invariants !== EXPECTED_INVARIANTS) {
    push(out, 'INVARIANT_CENSUS', `expected ${EXPECTED_INVARIANTS}, manifest declares ${m.census.invariants}, list holds ${list.length}`);
  }
  const familyKeys = Object.keys(m.families);
  if (familyKeys.length !== EXPECTED_FAMILIES || m.census.families !== EXPECTED_FAMILIES) {
    push(out, 'FAMILY_CENSUS', `expected ${EXPECTED_FAMILIES}, declared ${m.census.families}, defined ${familyKeys.length}`);
  }

  const seen = new Set<string>();
  const perFamily = new Map<string, number[]>();
  const testNames = new Set<string>();

  for (const inv of list) {
    const match = /^INV-([A-Z])(\d+)$/.exec(inv.id);
    if (!match) {
      push(out, 'INVARIANT_ID_SHAPE', `${inv.id} is not INV-<family letter><serial>`);
      continue;
    }
    const [, letter, serial] = match as unknown as [string, string, string];
    if (seen.has(inv.id)) push(out, 'INVARIANT_ID_DUPLICATE', inv.id);
    seen.add(inv.id);
    if (letter !== inv.family) {
      push(out, 'INVARIANT_ID_SHAPE', `${inv.id} declares family ${inv.family}`);
    }
    if (!familyKeys.includes(inv.family)) {
      push(out, 'INVARIANT_ID_SHAPE', `${inv.id} names undefined family ${inv.family}`);
    }
    const serials = perFamily.get(letter) ?? [];
    serials.push(Number(serial));
    perFamily.set(letter, serials);

    const o = inv.owners;
    const missing: string[] = [];
    if (!o || typeof o.normative !== 'string' || o.normative.length === 0) missing.push('normative');
    if (!o || !Array.isArray(o.enforcement) || o.enforcement.length === 0) missing.push('enforcement');
    if (!o || typeof o.persistence !== 'string' || o.persistence.length === 0) missing.push('persistence');
    if (!o || !Array.isArray(o.test) || o.test.length === 0) missing.push('test');
    if (o && o.persistence === 'n/a' && !o.persistence_note) missing.push('persistence_note');
    if (missing.length > 0) {
      push(out, 'OWNERSHIP_INCOMPLETE', `${inv.id} lacks ${missing.join(', ')}`);
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

  for (const [letter, serials] of perFamily) {
    const sorted = [...serials].sort((a, c) => a - c);
    const expected = sorted.map((_, i) => i + 1);
    if (sorted.join(',') !== expected.join(',')) {
      push(out, 'INVARIANT_FAMILY_SERIES', `family ${letter} serials are ${sorted.join(',')}`);
    }
  }

  const mapped = new Set(list.flatMap((i) => i.errata));
  for (const e of ERRATA) {
    if (!mapped.has(e)) push(out, 'ERRATA_UNMAPPED', `${e} reaches no invariant`);
  }
}

// --- 7-9: the action matrix ---------------------------------------------------------

export function checkActionMatrix(b: SpecBundle, out: Problem[]): void {
  const m = b.actionMatrix;
  const fieldNames = m.fields.map((f) => f.name);
  const kinds = Object.keys(m.kinds);

  if (fieldNames.length !== m.census.fields || new Set(fieldNames).size !== fieldNames.length) {
    push(out, 'MATRIX_NOT_TOTAL', `field list is ${fieldNames.length}, census says ${m.census.fields}`);
  }
  if (kinds.length !== m.census.action_kinds) {
    push(out, 'MATRIX_NOT_TOTAL', `${kinds.length} kinds, census says ${m.census.action_kinds}`);
  }
  if (m.always_required.length !== m.census.always_required_fields) {
    push(out, 'MATRIX_ALWAYS_REQUIRED', `always_required holds ${m.always_required.length}, census says ${m.census.always_required_fields}`);
  }

  let cells = 0;
  for (const kind of kinds) {
    const spec = m.kinds[kind];
    if (!spec) continue;
    const fields = spec.fields;
    for (const name of fieldNames) {
      const d = fields[name];
      if (d === undefined) {
        push(out, 'MATRIX_NOT_TOTAL', `${kind} does not disposition ${name}`);
        continue;
      }
      if (!m.dispositions.includes(d)) {
        push(out, 'MATRIX_BAD_DISPOSITION', `${kind}.${name} = ${String(d)}`);
      }
      cells += 1;
    }
    for (const name of Object.keys(fields)) {
      if (!fieldNames.includes(name)) {
        push(out, 'MATRIX_NOT_TOTAL', `${kind} dispositions unknown field ${name}`);
      }
    }
    for (const name of m.always_required) {
      if (fields[name] !== 'REQUIRED') {
        push(out, 'MATRIX_ALWAYS_REQUIRED', `${kind}.${name} is ${String(fields[name])}, not REQUIRED`);
      }
    }
    for (const [name, d] of Object.entries(fields)) {
      if (d === 'FIXED' && spec.fixed_values[name] === undefined) {
        push(out, 'MATRIX_FIXED_WITHOUT_VALUE', `${kind}.${name} is FIXED with no value`);
      }
    }
    if (!IDENTITY_SCHEMES.some((s) => spec.canonical_target.startsWith(s))) {
      push(out, 'MATRIX_TARGET_SCHEME_UNKNOWN', `${kind} target ${spec.canonical_target}`);
    }
  }

  if (cells !== m.census.cells) {
    push(out, 'MATRIX_NOT_TOTAL', `counted ${cells} cells, census says ${m.census.cells}`);
  }

  for (const group of m.field_groups) {
    for (const kind of group.applies_to) {
      const spec = m.kinds[kind];
      if (!spec) {
        push(out, 'MATRIX_GROUP_INCONSISTENT', `${group.name} applies to unknown kind ${kind}`);
        continue;
      }
      for (const member of group.members) {
        if (spec.fields[member] !== 'OPTIONAL') {
          push(out, 'MATRIX_GROUP_INCONSISTENT', `${kind}.${member} is ${String(spec.fields[member])}; an all-or-nothing group member must be OPTIONAL`);
        }
      }
    }
    for (const kind of Object.keys(m.kinds)) {
      if (group.applies_to.includes(kind)) continue;
      const f = m.kinds[kind]?.fields;
      if (!f) continue;
      const core: Disposition[] = [f['repository_identity'], f['base_sha'], f['head_sha']].filter(
        (x): x is Disposition => x !== undefined,
      );
      const anyBound = [f['base_sha'], f['head_sha'], f['pr_number']].some(
        (d) => d === 'REQUIRED' || d === 'OPTIONAL',
      );
      if (anyBound && core.some((d) => d !== 'REQUIRED')) {
        push(out, 'MATRIX_ISOLATED_PROVENANCE', `${kind} permits a head, base or PR number without requiring repository_identity, base_sha and head_sha together`);
      }
      if (f['pr_number'] !== 'FORBIDDEN' && f['repository_identity'] === 'FORBIDDEN') {
        push(out, 'MATRIX_ISOLATED_PROVENANCE', `${kind} permits pr_number with repository_identity forbidden`);
      }
    }
  }
}

// --- 10-12: slices, dependencies and migrations -------------------------------------

export function checkSlices(b: SpecBundle, out: Problem[]): void {
  const m = b.slices;
  const byId = new Map(m.slices.map((s) => [s.id, s]));
  const order = m.total_order;

  if (order.length !== m.slices.length) {
    push(out, 'SLICE_ORDER_CYCLE', `total_order lists ${order.length} of ${m.slices.length} slices`);
  }

  const position = new Map(order.map((id, i) => [id, i]));
  for (const s of m.slices) {
    const pos = position.get(s.id);
    if (pos === undefined) {
      push(out, 'SLICE_ORDER_CYCLE', `${s.id} is absent from total_order`);
      continue;
    }
    if (s.position !== pos + 1) {
      push(out, 'SLICE_ORDER_CYCLE', `${s.id} declares position ${s.position} but sits at ${pos + 1}`);
    }
    const expectedMerge = pos === 0 ? null : order[pos - 1];
    if (s.merge_predecessor !== expectedMerge) {
      push(out, 'SLICE_MERGE_PREDECESSOR', `${s.id} names ${String(s.merge_predecessor)}, expected ${String(expectedMerge)}`);
    }
    for (const dep of s.functional_dependencies) {
      const dp = position.get(dep);
      if (dp === undefined) {
        push(out, 'SLICE_ORDER_CYCLE', `${s.id} depends on unknown slice ${dep}`);
      } else if (dp >= pos) {
        push(out, 'SLICE_ORDER_CYCLE', `${s.id} depends forward on ${dep}`);
      }
    }
  }

  // Migrations advance by exactly one, in order, with no gaps and no repeats.
  const migrating = order
    .map((id) => byId.get(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined && s.migration !== null);
  const chain = migrating.map((s) => s.migration as string);
  if (chain.join(',') !== EXPECTED_MIGRATIONS.join(',') || m.migration_chain.join(',') !== EXPECTED_MIGRATIONS.join(',')) {
    push(out, 'MIGRATION_CHAIN', `chain is ${chain.join(',') || '(empty)'}, declared ${m.migration_chain.join(',')}`);
  }

  // A slice's schema predecessor is the migration produced by the nearest earlier
  // migrating slice, and PR-0 has none.
  for (const s of m.slices) {
    const pos = position.get(s.id);
    if (pos === undefined) continue;
    let expected: string | null = null;
    for (let i = pos - 1; i >= 0; i -= 1) {
      const prev = byId.get(order[i] as string);
      if (prev?.migration) {
        expected = prev.migration;
        break;
      }
    }
    if (s.id === 'PR-A') expected = null; // PR-A defines v1 and has no predecessor.
    if (s.schema_predecessor !== expected) {
      push(out, 'SLICE_SCHEMA_PREDECESSOR', `${s.id} names ${String(s.schema_predecessor)}, expected ${String(expected)}`);
    }
  }
}

// --- 13: the 141-row triage ---------------------------------------------------------

export function checkTriage(b: SpecBundle, out: Problem[]): void {
  const m = b.triage;
  const known = new Set(b.invariants.invariants.map((i) => i.id));
  const rows = m.rows;

  if (rows.length !== EXPECTED_TRIAGE_ROWS) {
    push(out, 'TRIAGE_ROW_COUNT', `${rows.length} rows, expected ${EXPECTED_TRIAGE_ROWS}`);
  }

  const seen = new Set<number>();
  const tally = { KEEP: 0, REWRITE: 0, DROP: 0 };
  for (const r of rows) {
    if (seen.has(r.row)) push(out, 'TRIAGE_ROW_DUPLICATE', `row ${r.row}`);
    seen.add(r.row);

    if (r.disposition !== 'KEEP' && r.disposition !== 'REWRITE' && r.disposition !== 'DROP') {
      push(out, 'TRIAGE_DISPOSITION_UNKNOWN', `row ${r.row}: ${String(r.disposition)}`);
      continue;
    }
    tally[r.disposition] += 1;

    if (!r.source_file || !r.scenario || !r.rationale) {
      push(out, 'TRIAGE_FIELD_MISSING', `row ${r.row} lacks a source file, scenario or rationale`);
    }
    if (r.source_head !== FROZEN_PR1_HEAD) {
      push(out, 'TRIAGE_SOURCE_HEAD', `row ${r.row} names ${r.source_head}`);
    }
    if (r.invariants.length === 0) {
      push(out, 'TRIAGE_FIELD_MISSING', `row ${r.row} maps to no invariant`);
    }
    for (const id of r.invariants) {
      if (!known.has(id)) push(out, 'TRIAGE_INVARIANT_UNKNOWN', `row ${r.row}: ${id}`);
    }
    if (r.disposition === 'REWRITE' && (!r.target_slice || !r.replacement)) {
      push(out, 'TRIAGE_FIELD_MISSING', `row ${r.row} is REWRITE without a target slice and replacement name`);
    }
    if (r.disposition === 'KEEP' && !r.target_slice) {
      push(out, 'TRIAGE_FIELD_MISSING', `row ${r.row} is KEEP without a target slice`);
    }
    if (r.disposition === 'DROP' && (r.target_slice || r.replacement)) {
      push(out, 'TRIAGE_FIELD_MISSING', `row ${r.row} is DROP but names a target or replacement`);
    }
  }

  for (let i = 1; i <= EXPECTED_TRIAGE_ROWS; i += 1) {
    if (!seen.has(i)) push(out, 'TRIAGE_ROW_COUNT', `row ${i} is missing`);
  }

  if (m.census.rows !== rows.length || m.census.KEEP !== tally.KEEP || m.census.REWRITE !== tally.REWRITE || m.census.DROP !== tally.DROP) {
    push(out, 'TRIAGE_CENSUS', `census ${JSON.stringify(m.census)} against counted ${JSON.stringify({ rows: rows.length, ...tally })}`);
  }
}

// --- 14: findings and debt ----------------------------------------------------------

export function checkFindings(b: SpecBundle, out: Problem[]): void {
  const m = b.findings;
  const known = new Set(b.invariants.invariants.map((i) => i.id));
  const debtIds = new Set(m.carried_debt.map((d) => d.id));
  const dispositions = ['FIX', 'ACCEPT', 'DEFER'];

  for (const f of m.findings) {
    if (f.invariants.length === 0) push(out, 'FINDING_UNMAPPED', `${f.id} maps to no invariant`);
    for (const id of f.invariants) {
      if (!known.has(id)) push(out, 'FINDING_UNMAPPED', `${f.id} names unknown ${id}`);
    }
    if (!dispositions.includes(f.disposition)) {
      push(out, 'FINDING_UNMAPPED', `${f.id} has disposition ${f.disposition}`);
    }
  }

  for (const round of m.rounds) {
    const actual = m.findings.filter((f) => f.round === round.round).length;
    if (actual !== round.itemised) {
      push(out, 'FINDING_ROUND_ACCOUNTING', `round ${round.round} declares ${round.itemised} itemised, holds ${actual}`);
    }
    const total = Object.values(round.aggregate).reduce((a, c) => a + c, 0);
    if (round.itemised + round.unitemised !== total) {
      push(out, 'FINDING_ROUND_ACCOUNTING', `round ${round.round}: ${round.itemised} + ${round.unitemised} does not equal the verdict total ${total}`);
    }
    if (round.unitemised > 0 && (round.unitemised_debt === null || !debtIds.has(round.unitemised_debt))) {
      push(out, 'FINDING_ROUND_ACCOUNTING', `round ${round.round} leaves ${round.unitemised} findings unaccounted for with no debt entry`);
    }
  }

  for (const d of m.carried_debt) {
    if (d.invariants.length === 0) push(out, 'DEBT_UNMAPPED', `${d.id} maps to no invariant`);
    for (const id of d.invariants) {
      if (!known.has(id)) push(out, 'DEBT_UNMAPPED', `${d.id} names unknown ${id}`);
    }
    if (!dispositions.includes(d.disposition) || !d.owner || !d.target) {
      push(out, 'DEBT_UNMAPPED', `${d.id} lacks a disposition, owner or target`);
    }
  }
}

// --- 15: decisions ------------------------------------------------------------------

export function checkDecisions(b: SpecBundle, out: Problem[]): void {
  const m = b.decisions;
  const ids = m.decisions.map((d) => d.id);
  const expected = Array.from({ length: 14 }, (_, i) => `D${i + 1}`);
  if (ids.join(',') !== expected.join(',')) {
    push(out, 'DECISION_SET', `ledger holds ${ids.join(',')}`);
  }
  for (const d of m.decisions) {
    if (!m.legal_states.includes(d.state)) {
      push(out, 'DECISION_STATE_ILLEGAL', `${d.id} is ${d.state}`);
    }
    if (d.state === 'APPROVED_AS_AMENDED' && !Array.isArray(d.amended_by)) {
      push(out, 'DECISION_STATE_ILLEGAL', `${d.id} is amended with no amendment list`);
    }
  }
  for (const s of m.standing_authorizations) {
    if (!m.legal_states.includes(s.state)) {
      push(out, 'DECISION_STATE_ILLEGAL', `standing authorization "${s.subject}" is ${s.state}`);
    }
  }
}

// --- 16: the two gates --------------------------------------------------------------

export function checkGates(b: SpecBundle, out: Problem[]): void {
  const gates = b.gates.gates;
  const ids = gates.map((g) => g.id);
  if (ids.length !== 2 || !ids.includes('phase0_completion') || !ids.includes('phase1a_entry')) {
    push(out, 'GATE_NOT_SEPARATE', `gates are ${ids.join(',')}`);
    return;
  }
  const phase0 = gates.find((g) => g.id === 'phase0_completion');
  const phase1a = gates.find((g) => g.id === 'phase1a_entry');
  if (!phase0 || !phase1a) return;

  const p0 = new Set(phase0.conditions.map((c) => c.id));
  for (const c of phase1a.conditions) {
    if (p0.has(c.id)) push(out, 'GATE_NOT_SEPARATE', `condition ${c.id} appears in both gates`);
  }
  for (const c of phase0.conditions) {
    if (/\bD13\b|\bD14\b/.test(c.text)) {
      push(out, 'GATE_PHASE_LEAK', `Phase 0 condition ${c.id} depends on a deferred Phase 1A decision`);
    }
  }
  const text1a = phase1a.conditions.map((c) => c.text).join(' ');
  if (!/\bD13\b/.test(text1a) || !/\bD14\b/.test(text1a)) {
    push(out, 'GATE_PHASE_LEAK', 'the Phase 1A entry gate does not require D13 and D14');
  }
}

// --- 17: PR #1 ordering -------------------------------------------------------------

export function checkPr1Ordering(b: SpecBundle, out: Problem[]): void {
  const doc = b.docs['11-pr1-disposition.md'] ?? '';
  let cursor = -1;
  PR1_STEPS.forEach((step, i) => {
    const at = doc.indexOf(step);
    if (at === -1) {
      push(out, 'PR1_ORDERING_ALTERED', `step ${i + 1} ("${step}") is missing`);
      return;
    }
    if (at < cursor) {
      push(out, 'PR1_ORDERING_ALTERED', `step ${i + 1} appears out of order`);
    }
    cursor = at;
  });
  if (!doc.includes(FROZEN_PR1_HEAD)) {
    push(out, 'PR1_ORDERING_ALTERED', 'the frozen PR #1 head is not recorded');
  }
}

// --- 18: the runtime boundary -------------------------------------------------------

export function checkRuntimeBoundary(b: SpecBundle, out: Problem[]): void {
  const forbidden = /from\s+['"][^'"]*(tools\/spec|spec\/manifests)[^'"]*['"]|require\(\s*['"][^'"]*(tools\/spec|spec\/manifests)[^'"]*['"]\s*\)/;
  for (const file of b.runtimeFiles) {
    if (forbidden.test(file.content)) {
      push(out, 'RUNTIME_IMPORTS_SPEC', `${file.path} imports the specification toolchain`);
    }
  }
  const build = b.configs['tsconfig.build.json'] ?? '';
  if (build.includes('tools/')) {
    push(out, 'BUILD_INCLUDES_TOOLS', 'tsconfig.build.json pulls tools/ into the runtime build');
  }
  const pkg = b.configs['package.json'] ?? '';
  const parsed = pkg ? (JSON.parse(pkg) as Record<string, unknown>) : {};
  const entryPoints = JSON.stringify({
    main: parsed['main'],
    exports: parsed['exports'],
    bin: parsed['bin'],
  });
  if (entryPoints.includes('tools/')) {
    push(out, 'BUILD_INCLUDES_TOOLS', 'a package entry point resolves into tools/');
  }
}

// --- doc drift ----------------------------------------------------------------------

export function checkDocDrift(b: SpecBundle, out: Problem[]): void {
  const rendered = renderInvariants(b.invariants);
  const onDisk = b.docs['01-invariants.md'] ?? '';
  if (rendered.trim() !== onDisk.trim()) {
    push(out, 'DOC_INVARIANT_DRIFT', 'spec/01-invariants.md does not match a fresh render of invariants.json');
  }
}

// --- 19: every failure class has a negative fixture ---------------------------------

export function checkNegativeFixtures(b: SpecBundle, out: Problem[]): void {
  const tests = b.configs['tests/spec/validator-negative.test.ts'] ?? '';
  if (tests.length === 0) {
    push(out, 'NEGATIVE_FIXTURE_MISSING', 'tests/spec/validator-negative.test.ts is absent');
    return;
  }
  for (const code of FAILURE_CODES) {
    if (!tests.includes(`'${code}'`)) {
      push(out, 'NEGATIVE_FIXTURE_MISSING', `${code} has no negative fixture`);
    }
  }
}

export function runChecks(b: SpecBundle): Problem[] {
  const out: Problem[] = [];
  checkInvariants(b, out);
  checkActionMatrix(b, out);
  checkSlices(b, out);
  checkTriage(b, out);
  checkFindings(b, out);
  checkDecisions(b, out);
  checkGates(b, out);
  checkPr1Ordering(b, out);
  checkRuntimeBoundary(b, out);
  checkDocDrift(b, out);
  checkNegativeFixtures(b, out);
  return out;
}
