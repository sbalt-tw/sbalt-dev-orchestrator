import { describe, it, expect } from 'vitest';
import { loadBundle, repoRoot } from '../../tools/spec/load.js';
import { runChecks, checkNegativeFixtures, FAILURE_CODES } from '../../tools/spec/checks.js';
import type { Problem } from '../../tools/spec/checks.js';
import { renderInvariants } from '../../tools/spec/render.js';
import { fixtures } from '../../tools/spec/fixtures.js';
import * as A from '../../tools/spec/anchors.js';

const bundle = loadBundle(repoRoot());

describe('specification validator', () => {
  it('reports no problem against the committed specification', () => {
    const problems = runChecks(bundle);
    expect(problems.map((p) => `${p.code}: ${p.detail}`)).toEqual([]);
  });

  it('loads every required document and manifest without a load problem', () => {
    expect(bundle.loadProblems).toEqual([]);
  });

  it('carries exactly 47 invariants in 8 families, matching the anchor', () => {
    expect(bundle.invariants.invariants.map((i) => i.id).sort()).toEqual([...A.INVARIANT_IDS].sort());
    expect(Object.keys(bundle.invariants.families).sort()).toEqual(Object.keys(A.FAMILY_NAMES).sort());
  });

  it('maps every erratum FE-1 to FE-8 exactly as anchored, and FE-9 to nothing', () => {
    const map = new Map<string, string[]>();
    for (const inv of bundle.invariants.invariants) {
      for (const e of inv.errata) map.set(e, [...(map.get(e) ?? []), inv.id]);
    }
    for (const [fe, expected] of Object.entries(A.ERRATA_MAP)) {
      expect([...(map.get(fe) ?? [])].sort(), fe).toEqual([...expected].sort());
    }
    expect(map.has('FE-9')).toBe(false);
  });

  it('keeps the action matrix at 7 kinds x 25 fields with one disposition each', () => {
    const kinds = Object.keys(bundle.actionMatrix.kinds);
    expect(kinds.sort()).toEqual(Object.keys(A.ACTION_KINDS).sort());
    for (const kind of kinds) {
      const fields = bundle.actionMatrix.kinds[kind]!.fields;
      expect(Object.keys(fields).sort(), kind).toEqual([...A.ENVELOPE_FIELDS].sort());
    }
    expect(bundle.actionMatrix.census).toEqual(A.MATRIX_CENSUS);
  });

  it('states use_limit explicitly in every kind and bounds the two that are caller-chosen', () => {
    const k = bundle.actionMatrix.kinds;
    expect(k['staging_write']!.fields['use_limit']).toBe('REQUIRED');
    expect(k['worker_dispatch']!.fields['use_limit']).toBe('REQUIRED');
    for (const kind of ['merge', 'production_write', 'destructive_operation', 'policy_weakening', 'waive_finding']) {
      expect(k[kind]!.fields['use_limit'], kind).toBe('FIXED');
      expect(k[kind]!.fixed_values['use_limit'], kind).toBe(1);
    }
    const max = bundle.policyParameters.parameters.find((p) => p.key === 'worker_dispatch.max_use_limit');
    expect(max?.maximum).toBe(A.POLICY_PARAMETERS['worker_dispatch.max_use_limit']!.maximum);
  });

  it('gives worker_dispatch dispatch authority and nothing else', () => {
    const wd = bundle.actionMatrix.kinds['worker_dispatch']!;
    expect(wd.canonical_target.startsWith('worker:')).toBe(true);
    expect(wd.fields['evidence_snapshot_ref']).toBe('FORBIDDEN');
    expect(wd.notes).toMatch(/authorises dispatch only/);
  });

  it('makes the task-state table total, with no wildcard and no outgoing terminal transition', () => {
    const t = bundle.taskState;
    expect(t.states).toEqual([...A.TASK_STATES]);
    expect(t.terminal_states).toEqual([...A.TERMINAL_STATES]);
    expect(t.transitions).toHaveLength(A.TASK_STATE_CENSUS.pairs);
    for (const state of A.TASK_STATES) {
      for (const event of A.TASK_EVENTS) {
        const cell = t.transitions.find((x) => x.from === state && x.event === event);
        expect(cell, `${state}/${event}`).toBeDefined();
        expect(['ALLOWED', 'REFUSED'], `${state}/${event}`).toContain(cell!.decision);
      }
    }
    for (const cell of t.transitions.filter((x) => A.TERMINAL_STATES.includes(x.from))) {
      expect(cell.decision, `${cell.from}/${cell.event}`).toBe('REFUSED');
    }
  });

  it('keeps obligations separate from the state label and lets several be open at once', () => {
    const t = bundle.taskState;
    expect(t.obligations.WAITING).toEqual([...A.WAITING_OBLIGATIONS]);
    expect(t.obligations.BLOCKED).toEqual([...A.BLOCKED_OBLIGATIONS]);
    expect(t.obligation_model['multiplicity']).toMatch(/Resolving one never clears another/);
    expect(t.caller_contract.never_submits.join(' ')).toMatch(/target state/i);
  });

  it('refuses success while any obligation, unknown effect or abandoned effect stands', () => {
    const text = bundle.taskState.success_preconditions.join(' ');
    expect(text).toMatch(/No obligation of any kind is open/);
    expect(text).toMatch(/UNKNOWN_PENDING_RECONCILIATION/);
    expect(text).toMatch(/ABANDONED_BY_DECISION/);
    expect(bundle.taskState.abandonment_rules.join(' ')).toMatch(/G0-8/);
  });

  it('orders evidence by trusted generation and never by time', () => {
    const e = bundle.evidenceModel;
    expect(e.ordering.authoritative).toBe(A.EVIDENCE_ORDERING_FIELD);
    expect(e.ordering.forbidden_tiebreaks).toContain('observed_at');
    expect(e.conflict['same_generation_different_digest']).toMatch(/CONFLICTED/);
    expect(e.content_fields.map((f) => f.name)).toContain('evidence_slot_identity');
  });

  it('fixes the infrastructure attempt limit at two and excludes unknown effects', () => {
    const retry = bundle.policyParameters.infrastructure_retry;
    expect(retry['attempts']).toBe(A.INFRASTRUCTURE_ATTEMPTS);
    expect(String(retry['unknown_effects_excluded'])).toMatch(/probed by redemption_key/);
  });

  it('keeps both phase gates non-waivable and G0-8 closed against abandonment', () => {
    for (const gate of bundle.gates.gates) {
      expect(gate.waivable, gate.id).toBe(false);
    }
    const g08 = bundle.gates.gates
      .find((g) => g.id === 'phase0_completion')!
      .conditions.find((c) => c.id === 'G0-8')!;
    expect([...(g08.rejects ?? [])].sort()).toEqual([...A.G0_8_REJECTS].sort());
    expect(g08.text).toMatch(/ABANDONED_BY_DECISION/);
  });

  it('makes the Phase 1A gate consume decisions rather than count rows', () => {
    const phase1a = bundle.gates.gates.find((g) => g.id === 'phase1a_entry')!;
    for (const [conditionId, decisionId] of Object.entries(A.PHASE1A_DECISION_REQUIREMENTS)) {
      const req = phase1a.conditions.find((c) => c.id === conditionId)!.requires_decision!;
      expect(req.decision_id, conditionId).toBe(decisionId);
      expect(req.outcome, conditionId).toBe('APPROVED');
      expect(req.requires_content_ref && req.requires_content_version && req.evaluate_consequence, conditionId).toBe(true);
    }
  });

  it('records D1 to D19 with the anchored states', () => {
    for (const row of bundle.decisions.decisions) {
      expect(row.state, row.id).toBe(A.DECISION_STATES[row.id]);
    }
    expect(bundle.decisions.decisions.map((d) => d.id).sort()).toEqual(Object.keys(A.DECISION_STATES).sort());
  });

  it('leaves PR-0 merge, PR #1 closure and Phase 1A unauthorised', () => {
    const bySubject = new Map(bundle.decisions.standing_authorizations.map((s) => [s.subject, s.state]));
    for (const subject of A.STANDING_NOT_AUTHORIZED) {
      expect(bySubject.get(subject), subject).toBe('NOT_AUTHORIZED');
    }
  });

  it('holds 141 triage rows, and every slice-local row names an owner and a test', () => {
    expect(bundle.triage.rows).toHaveLength(A.TRIAGE_CENSUS.rows);
    const sliceLocal = bundle.triage.rows.filter((r) => r.mapping_basis === 'slice_local');
    expect(sliceLocal.map((r) => r.row).sort((a, c) => a - c)).toEqual([...A.TRIAGE_SLICE_LOCAL_ROWS]);
    for (const r of sliceLocal) {
      expect(r.invariants, `row ${r.row}`).toEqual([]);
      expect(r.slice_local?.owner_slice, `row ${r.row}`).toBeTruthy();
      expect(r.slice_local?.named_test, `row ${r.row}`).toBeTruthy();
      expect(r.slice_local?.why_no_invariant, `row ${r.row}`).toBeTruthy();
    }
  });

  it('closes all 22 Round-1 findings with a recorded closure', () => {
    const pr0 = bundle.findings.pr0_review;
    expect(pr0.findings.map((f) => f.id)).toEqual([...A.PR0_ROUND1_FINDING_IDS]);
    expect(pr0.rounds[0]!.verdict).toEqual({ ...A.PR0_ROUND1_VERDICT });
    for (const f of pr0.findings) {
      expect(f.closure, f.id).toBeTruthy();
      expect(f.closed_by, f.id).toBeTruthy();
    }
  });

  it('gives DEBT-2 a rule, an owner and an exit condition', () => {
    const debt2 = bundle.findings.carried_debt.find((d) => d.id === 'DEBT-2')!;
    expect(debt2.rule).toBeTruthy();
    expect(debt2.exit_condition).toBeTruthy();
    expect(debt2.owner).toBe('PR-G');
  });

  it('keeps the PR #1 ordering in its anchored sequence', () => {
    const steps = [...bundle.pr1Ordering.steps].sort((a, b) => a.step - b.step);
    expect(steps.map((s) => s.action)).toEqual([...A.PR1_ORDERING_STEPS]);
    expect(bundle.pr1Ordering.reordering_permitted).toBe(false);
    expect(bundle.pr1Ordering.pr1.frozen_head).toBe(A.FROZEN_PR1_HEAD);
  });

  it('keeps 01-invariants.md identical to a fresh render of the manifest', () => {
    expect(bundle.docs['01-invariants.md']!.trim()).toBe(renderInvariants(bundle.invariants).trim());
  });

  it('records the corrected Round-1 census of the validator', () => {
    expect(A.CENSUS_AT_ROUND1_HEAD).toEqual({ fixtures: 44, failure_codes: 40 });
    expect(A.CENSUS_CURRENT).toEqual({ fixtures: fixtures.length, failure_codes: FAILURE_CODES.length });
  });
});

// The two self-referential codes cannot be provoked by mutating a bundle, so they are
// tested here directly against the fixture runner.
describe('the fixture runner polices itself', () => {
  it('reports NEGATIVE_FIXTURE_MISSING when a failure class has no fixture', () => {
    const out: Problem[] = [];
    checkNegativeFixtures(bundle, out, { fixtures: [] });
    const codes = out.map((p) => p.code);
    expect(codes).toContain('NEGATIVE_FIXTURE_MISSING');
  });

  it('reports NEGATIVE_FIXTURE_INERT when a fixture does not provoke its code', () => {
    const out: Problem[] = [];
    checkNegativeFixtures(bundle, out, {
      fixtures: [{ code: 'TRIAGE_ROW_COUNT', why: 'a fixture that changes nothing', mutate: () => undefined }],
    });
    expect(out.map((p) => p.code)).toContain('NEGATIVE_FIXTURE_INERT');
  });
});
