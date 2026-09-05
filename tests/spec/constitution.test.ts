import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadBundle, runChecks, repoRoot, FAILURE_CODES } from '../../tools/spec/constitution.js';
import type { Bundle, FailureCode } from '../../tools/spec/constitution.js';

const root = repoRoot();
const pristine = loadBundle(root);
const clone = (): Bundle => structuredClone(pristine);
const rec = (b: Bundle, k: string): Record<string, unknown> => b.manifest[k] as Record<string, unknown>;
const list = (b: Bundle, k: string): unknown[] => b.manifest[k] as unknown[];

describe('the committed constitution', () => {
  it('is structurally valid', () => {
    expect(runChecks(pristine).map((p) => `${p.code}: ${p.detail}`)).toEqual([]);
  });

  it('records no reviewed baseline yet, because none exists', () => {
    expect(pristine.manifest['reviewed_baseline']).toBeNull();
    expect(String(pristine.manifest['reviewed_baseline_note'])).toMatch(/never means unchanged/i);
  });

  it('approves exactly the seven decisions the Founder approved', () => {
    const approved = (list(pristine, 'decisions') as { id: string; state: string }[])
      .filter((d) => d.state === 'APPROVED').map((d) => d.id).sort();
    expect(approved).toEqual(['D20', 'D26', 'D27', 'D28', 'D29', 'D30', 'D32']);
  });

  it('leaves every domain decision to its checkpoint', () => {
    const byId = new Map((list(pristine, 'decisions') as { id: string; state: string; decided_by?: string }[])
      .map((d) => [d.id, d]));
    for (const [id, owner] of [['D21', 'SPEC-B'], ['D22', 'SPEC-B'], ['D23', 'SPEC-B'],
      ['D24', 'SPEC-D'], ['D25', 'SPEC-D'], ['D31', 'SPEC-F']] as const) {
      expect(byId.get(id)?.state, id).toBe('DEFERRED');
      expect(byId.get(id)?.decided_by, id).toBe(owner);
    }
  });

  it('assumes no provider identifier is ordered', () => {
    expect(String(pristine.manifest['provider_ordering_assumption'])).toMatch(/^none/i);
    expect(pristine.document).not.toMatch(/check-run id|workflow-run id|monotonic(ally)? (increasing|ordered) id/i);
  });

  it('carries no domain design', () => {
    for (const token of ['DISPATCHING', 'redemption_key', 'evidence_snapshot_ref',
      'worker_dispatch', 'CREATE TABLE', 'ALTER TABLE', 'schema_version', 'use_limit']) {
      expect(pristine.document, token).not.toContain(token);
    }
    expect(existsSync(join(root, 'src'))).toBe(false);
  });

  it('stays inside every surface cap', () => {
    const normative = ['spec/CONSTITUTION.md', 'spec/manifests/constitution.json']
      .reduce((n, f) => n + readFileSync(join(root, f), 'utf8').split('\n').length, 0);
    expect(normative).toBeLessThanOrEqual(700);
    expect((list(pristine, 'concepts')).length).toBeLessThanOrEqual(5);
  });

  it('says plainly what the validator cannot prove', () => {
    expect(list(pristine, 'validator_non_goals').join(' ')).toMatch(/establishing its own authority root/i);
    expect(pristine.document.replace(/\s+/g, ' '))
      .toMatch(/never be cited as evidence that a specification is correct/i);
  });
});

// One mutation per failure class. A guard that has never been seen to fire is not a guard.
const fixtures: { code: FailureCode; why: string; mutate: (b: Bundle) => void }[] = [
  { code: 'MANIFEST_MISSING', why: 'the manifest is absent', mutate: (b) => { b.present.manifest = false; b.present.parsed = false; } },
  { code: 'MANIFEST_MALFORMED', why: 'the manifest does not parse', mutate: (b) => { b.present.parsed = false; } },
  { code: 'DOCUMENT_MISSING', why: 'the document is absent', mutate: (b) => { b.present.document = false; b.document = ''; } },
  { code: 'PROOF_CLASSES', why: 'semantic authority is made mechanical', mutate: (b) => { (list(b, 'proof_classes')[2] as Record<string, unknown>)['mechanical'] = true; } },
  { code: 'AUTHORITY_ROOT', why: 'a record leaves the authority root', mutate: (b) => { list(b, 'authority_root').pop(); } },
  { code: 'VALIDATOR_NON_GOALS', why: 'the non-goals are trimmed away', mutate: (b) => { b.manifest['validator_non_goals'] = ['one']; } },
  { code: 'SURFACE_CAPS', why: 'generated files stop counting', mutate: (b) => { rec(b, 'surface_caps')['changed_files_include_generated'] = false; } },
  { code: 'SEVERITY_VOCABULARY', why: 'CRITICAL becomes its own severity', mutate: (b) => { b.manifest['critical_is_recorded_as'] = 'CRITICAL'; } },
  { code: 'DISPOSITION_DEFAULT', why: 'a default disposition appears', mutate: (b) => { b.manifest['disposition_default'] = 'ACCEPT'; } },
  { code: 'BUDGETS', why: 'a two-round target is marked extendable', mutate: (b) => { (list(b, 'budgets')[0] as Record<string, unknown>)['extendable_once'] = true; } },
  { code: 'SINGLE_ROUND_EXTENSION', why: 'the third-round prohibition is dropped', mutate: (b) => { (rec(b, 'single_round_extension')['rules'] as string[]).splice(2, 1); } },
  { code: 'STOP_RULES', why: 'a stop rule disappears', mutate: (b) => { list(b, 'stop_rules').pop(); } },
  { code: 'MERGE_CONDITIONS', why: 'the merge conditions are thinned', mutate: (b) => { b.manifest['merge_conditions'] = ['green']; } },
  { code: 'CLOSURE_CONTRACT', why: 'self-assertion becomes evidence', mutate: (b) => { rec(b, 'closure_contract')['self_assertion_is_evidence'] = true; } },
  { code: 'SECURITY_EVIDENCE', why: 'public text may restate a payload', mutate: (b) => { rec(b, 'closure_contract')['public_text_rule'] = 'anything goes'; } },
  { code: 'REVIEWER_CAPACITY', why: 'capacity is measured in claim records', mutate: (b) => { rec(b, 'reviewer_capacity')['measured_in'] = 'active claim records'; } },
  { code: 'GATES', why: 'a decision row alone satisfies the Phase 1A gate', mutate: (b) => { (list(b, 'gates')[1] as Record<string, unknown>)['row_existence_satisfies'] = true; } },
  { code: 'NON_WAIVABLE', why: 'a non-waivable subject is removed', mutate: (b) => { list(b, 'non_waivable').pop(); } },
  { code: 'ORDER', why: 'a checkpoint may overlap its implementation', mutate: (b) => { rec(b, 'order')['overlap_permitted'] = true; } },
  { code: 'SUPERSEDED_PRS', why: 'closure stops needing its own authorisation', mutate: (b) => { b.manifest['superseded_closure_requires_separate_authorisation'] = false; } },
  { code: 'ASSET_DISPOSITION', why: 'a disposition class is invented', mutate: (b) => { list(b, 'asset_disposition_classes').push('KEEP_BECAUSE_EXPENSIVE'); } },
  { code: 'PROVIDER_ORDERING', why: 'a provider is assumed ordered', mutate: (b) => { b.manifest['provider_ordering_assumption'] = 'check-run ids increase'; } },
  { code: 'DECISION_LEDGER', why: 'a deferred decision is quietly approved', mutate: (b) => { (list(b, 'decisions').find((d) => (d as { id: string }).id === 'D21') as Record<string, unknown>)['state'] = 'APPROVED'; } },
  { code: 'CONCEPT_CAP', why: 'a sixth load-bearing concept appears', mutate: (b) => { list(b, 'concepts').push('task lifecycle'); } },
  { code: 'BASELINE_UNBOUND', why: 'a baseline is recorded with no external binding', mutate: (b) => { b.manifest['reviewed_baseline'] = { sha: 'deadbeef' }; } },
  { code: 'DOMAIN_DESIGN_PRESENT', why: 'domain design leaks into the constitution', mutate: (b) => { b.document += '\nThe task moves to DISPATCHING.\n'; } },
];

describe('every check can fail', () => {
  for (const f of fixtures) {
    it(`${f.code}: ${f.why}`, () => {
      const b = clone();
      f.mutate(b);
      expect(runChecks(b).map((p) => p.code)).toContain(f.code);
    });
  }

  it('covers every declared failure code', () => {
    const covered = new Set(fixtures.map((f) => f.code));
    expect(FAILURE_CODES.filter((c) => !covered.has(c))).toEqual([]);
  });

  it('leaves the pristine bundle clean, so the fixtures are what turn the checks red', () => {
    expect(runChecks(clone())).toEqual([]);
  });
});
