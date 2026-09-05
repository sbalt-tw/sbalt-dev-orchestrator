import { describe, it, expect } from 'vitest';
import { loadBundle, repoRoot } from '../../tools/spec/load.js';
import { runChecks, FAILURE_CODES } from '../../tools/spec/checks.js';
import { renderInvariants } from '../../tools/spec/render.js';

const bundle = loadBundle(repoRoot());

describe('specification validator', () => {
  it('reports no problem against the committed specification', () => {
    const problems = runChecks(bundle);
    expect(problems.map((p) => `${p.code}: ${p.detail}`)).toEqual([]);
  });

  it('carries exactly 47 invariants in 8 families', () => {
    expect(bundle.invariants.invariants).toHaveLength(47);
    expect(Object.keys(bundle.invariants.families)).toHaveLength(8);
    expect(bundle.invariants.census).toEqual({ invariants: 47, families: 8 });
  });

  it('gives every invariant four owners, a lineage and both kinds of test', () => {
    for (const inv of bundle.invariants.invariants) {
      expect(inv.owners.normative, inv.id).toBeTruthy();
      expect(inv.owners.enforcement.length, inv.id).toBeGreaterThan(0);
      expect(inv.owners.persistence, inv.id).toBeTruthy();
      expect(inv.owners.test.length, inv.id).toBeGreaterThan(0);
      expect(inv.introducing_slice, inv.id).toBeTruthy();
      expect(inv.tests.some((t) => t.kind === 'positive'), inv.id).toBe(true);
      expect(inv.tests.some((t) => t.kind === 'negative'), inv.id).toBe(true);
    }
  });

  it('explains every n/a persistence owner', () => {
    for (const inv of bundle.invariants.invariants) {
      if (inv.owners.persistence === 'n/a') {
        expect(inv.owners.persistence_note, inv.id).toBeTruthy();
      }
    }
  });

  it('maps every erratum FE-1 to FE-8 onto at least one invariant', () => {
    const mapped = new Set(bundle.invariants.invariants.flatMap((i) => i.errata));
    for (const fe of ['FE-1', 'FE-2', 'FE-3', 'FE-4', 'FE-5', 'FE-6', 'FE-7', 'FE-8']) {
      expect(mapped.has(fe), fe).toBe(true);
    }
  });

  it('sharpens every invariant the errata name', () => {
    const required = [
      'INV-A1', 'INV-A2', 'INV-A3', 'INV-A4', 'INV-A5', 'INV-A6',
      'INV-E1', 'INV-E2', 'INV-E3', 'INV-E4',
      'INV-X1', 'INV-X2', 'INV-X3', 'INV-X4',
      'INV-L5', 'INV-L7', 'INV-P1', 'INV-P2',
    ];
    const sharpened = new Set(
      bundle.invariants.invariants.filter((i) => i.sharpened).map((i) => i.id),
    );
    for (const id of required) expect(sharpened.has(id), id).toBe(true);
  });

  it('keeps the action matrix total: 6 kinds x 25 fields, one disposition each', () => {
    const names = bundle.actionMatrix.fields.map((f) => f.name);
    expect(names).toHaveLength(25);
    const kinds = Object.keys(bundle.actionMatrix.kinds);
    expect(kinds).toHaveLength(6);
    for (const kind of kinds) {
      const fields = bundle.actionMatrix.kinds[kind]!.fields;
      expect(Object.keys(fields).sort(), kind).toEqual([...names].sort());
      for (const name of names) {
        expect(bundle.actionMatrix.dispositions, `${kind}.${name}`).toContain(fields[name]);
      }
    }
  });

  it('states use_limit explicitly in every kind and never defaults it', () => {
    const k = bundle.actionMatrix.kinds;
    expect(k['staging_write']!.fields['use_limit']).toBe('REQUIRED');
    for (const kind of ['merge', 'production_write', 'destructive_operation', 'policy_weakening', 'waive_finding']) {
      expect(k[kind]!.fields['use_limit'], kind).toBe('FIXED');
      expect(k[kind]!.fixed_values['use_limit'], kind).toBe(1);
    }
  });

  it('holds exactly 141 triage rows, each numbered once', () => {
    const rows = bundle.triage.rows;
    expect(rows).toHaveLength(141);
    expect(new Set(rows.map((r) => r.row)).size).toBe(141);
    expect(Math.min(...rows.map((r) => r.row))).toBe(1);
    expect(Math.max(...rows.map((r) => r.row))).toBe(141);
  });

  it('binds every triage row to the frozen PR #1 head', () => {
    for (const r of bundle.triage.rows) {
      expect(r.source_head, `row ${r.row}`).toBe('428ae75e91fa1dd23c371d5f7af745aba0bec7fd');
    }
  });

  it('keeps the two gates separate and leaves D13 and D14 out of Phase 0', () => {
    const phase0 = bundle.gates.gates.find((g) => g.id === 'phase0_completion')!;
    const phase1a = bundle.gates.gates.find((g) => g.id === 'phase1a_entry')!;
    expect(phase0.conditions.some((c) => /D13|D14/.test(c.text))).toBe(false);
    expect(phase1a.conditions.some((c) => /D13/.test(c.text))).toBe(true);
    expect(phase1a.conditions.some((c) => /D14/.test(c.text))).toBe(true);
  });

  it('records D1 to D14 with legal states only', () => {
    const ids = bundle.decisions.decisions.map((d) => d.id);
    expect(ids).toEqual(Array.from({ length: 14 }, (_, i) => `D${i + 1}`));
    for (const d of bundle.decisions.decisions) {
      expect(bundle.decisions.legal_states, d.id).toContain(d.state);
    }
  });

  it('leaves PR-0 merge, PR #1 closure and Phase 1A unauthorised', () => {
    const bySubject = new Map(
      bundle.decisions.standing_authorizations.map((s) => [s.subject, s.state]),
    );
    expect(bySubject.get('PR-0 merge')).toBe('NOT_AUTHORIZED');
    expect(bySubject.get('PR #1 closure')).toBe('NOT_AUTHORIZED');
    expect(bySubject.get('Phase 1A implementation')).toBe('NOT_AUTHORIZED');
  });

  it('keeps 01-invariants.md identical to a fresh render of the manifest', () => {
    expect(bundle.docs['01-invariants.md']!.trim()).toBe(
      renderInvariants(bundle.invariants).trim(),
    );
  });

  it('declares a failure code for every mechanical check', () => {
    expect(new Set(FAILURE_CODES).size).toBe(FAILURE_CODES.length);
    expect(FAILURE_CODES.length).toBeGreaterThanOrEqual(41);
  });
});
