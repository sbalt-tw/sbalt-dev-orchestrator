import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBundle, runChecks, repoRoot, PREDICATES } from '../../tools/spec/constitution.js';
import type { Bundle, Predicate } from '../../tools/spec/constitution.js';

const root = repoRoot();
const pristine = loadBundle(root);
const clone = (): Bundle => structuredClone(pristine);
const R = (b: Bundle, k: string): Record<string, unknown> => b.manifest[k] as Record<string, unknown>;
const L = (b: Bundle, k: string): unknown[] => b.manifest[k] as unknown[];
const stage = (b: Bundle, id: string): Record<string, unknown> =>
  (L(b, 'budgets') as Record<string, unknown>[]).find((x) => x['stage'] === id)!;

describe('the committed constitution', () => {
  it('is structurally valid', () => {
    expect(runChecks(pristine).map((p) => `${p.predicate}: ${p.detail}`)).toEqual([]);
  });

  it('states the baseline as not established, and claims nothing about change', () => {
    const base = R(pristine, 'reviewed_baseline');
    expect(base['state']).toBe('NOT_ESTABLISHED');
    expect(base['tuple']).toBeNull();
    expect(String(base['note'])).toMatch(/Nothing may be described as unchanged since review/i);
    expect(pristine.document).not.toMatch(/passing validator means[^.]*unchanged since review/i);
    expect(readFileSync(join(root, 'README.md'), 'utf8'))
      .not.toMatch(/well-formed and unchanged since review/i);
  });

  it('freezes all nineteen stages in order', () => {
    const stages = (R(pristine, 'stage_registry')['stages'] as { position: number; id: string }[]);
    expect(stages).toHaveLength(19);
    expect(stages.map((s) => s.id)).toEqual(['PR-C0', 'SPEC-A', 'PR-A', 'SPEC-B', 'PR-B',
      'SPEC-C', 'PR-C', 'SPEC-D', 'PR-D', 'SPEC-E', 'PR-E', 'SPEC-F', 'PR-F', 'SPEC-G',
      'PR-G', 'SPEC-H', 'PR-H', 'SPEC-I', 'PR-I']);
    expect(stages.map((s) => s.position)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
  });

  it('gives every stage exactly one budget row and never permits a third verdict', () => {
    const rows = L(pristine, 'budgets') as { stage: string; max_completed_verdicts: number }[];
    expect(rows).toHaveLength(19);
    expect(new Set(rows.map((r) => r.stage)).size).toBe(19);
    for (const r of rows) {
      expect(r.max_completed_verdicts, r.stage).toBe(r.stage === 'PR-F' ? 3 : 2);
    }
  });

  it('closes semantic findings without inventing an oracle', () => {
    const c = (L(pristine, 'closure_routes') as { proof_class: string; requires: string[]; executable_oracle_required?: boolean }[])
      .find((r) => r.proof_class === 'C')!;
    expect(c.executable_oracle_required).toBe(false);
    expect(c.requires).toHaveLength(4);
    expect(c.requires.join(' ')).toMatch(/independent reviewer verdict/i);
    expect(String(R(pristine, 'asserted_not_proven')['never_applies_because']))
      .toMatch(/no program can test a purely semantic claim/i);
  });

  it('binds a verdict to a tuple, not to a head', () => {
    expect(L(pristine, 'review_tuple_components')).toHaveLength(9);
    expect(L(pristine, 'review_tuple_components')).toContain('merge_base_sha');
    expect(pristine.manifest['review_tuple_change_invalidates_verdict']).toBe(true);
  });

  it('requires exact-head CI and disclaims the synthetic merge checkout', () => {
    const ci = L(pristine, 'ci_requirements').map(String).join(' ');
    expect(ci).toMatch(/github\.event\.pull_request\.head\.sha/);
    expect(ci).toMatch(/assert git rev-parse HEAD/i);
    const wf = readFileSync(join(root, '.github', 'workflows', 'spec.yml'), 'utf8');
    expect(wf).toMatch(/ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
    expect(wf).not.toMatch(/echo "\$changed"/);
  });

  it('states counting rules that leave nothing to judgement', () => {
    const counting = R(pristine, 'surface_caps')['counting'] as Record<string, string>;
    expect(counting['binary_files']).toMatch(/fail[s]? closed/i);
    expect(counting['changed_files']).toMatch(/rename or copy counts both/i);
    expect(counting['total_reviewed_diff_lines']).toMatch(/only lockfile lines/i);
    expect(counting['per_file_line_cap']).toMatch(/none exists/i);
    expect(L(pristine, 'normative_markdown_paths')).toEqual(['spec/CONSTITUTION.md']);
  });

  it('refuses to claim it can count concepts', () => {
    expect(pristine.manifest['concept_count_is_semantic_assessment']).toBe(true);
    expect(L(pristine, 'validator_non_goals').join(' ')).toMatch(/counting load-bearing concepts/i);
  });

  it('describes the lexical guard as narrow rather than as proof of scope', () => {
    const g = R(pristine, 'lexical_guard');
    expect(g['proves_absence_of_domain_design']).toBe(false);
    expect(String(g['kind'])).toMatch(/narrow/i);
  });

  it('keeps every domain decision with its checkpoint', () => {
    const byId = new Map((L(pristine, 'decisions') as { id: string; state: string; decided_by?: string }[]).map((d) => [d.id, d]));
    for (const [id, owner] of [['D21', 'SPEC-B'], ['D24', 'SPEC-D'], ['D31', 'SPEC-F']] as const) {
      expect(byId.get(id)?.state, id).toBe('DEFERRED');
      expect(byId.get(id)?.decided_by, id).toBe(owner);
    }
  });

  it('stays inside the handwritten normative cap', () => {
    const lines = readFileSync(join(root, 'spec', 'CONSTITUTION.md'), 'utf8').split('\n').length;
    expect(lines).toBeLessThanOrEqual(700);
  });
});

// One mutation per predicate. A guard that has never been seen to fire is not a guard, and
// a shared failure code hides which predicate actually fired — so these target predicates.
const f = (predicate: Predicate, why: string, mutate: (b: Bundle) => void) => ({ predicate, why, mutate });
const fixtures = [
  f('manifest.present', 'the manifest is absent', (b) => { b.present.manifest = false; }),
  f('manifest.parses', 'the manifest does not parse', (b) => { b.present.parsed = false; }),
  f('manifest.schema', 'a required key is removed', (b) => { delete b.manifest['scope']; }),
  f('manifest.unknownKeys', 'an unknown top-level key appears', (b) => { b.manifest['extra'] = 1; }),
  f('document.present', 'the document is empty', (b) => { b.present.document = false; b.document = ''; }),
  f('document.lexicalGuard', 'a banned literal appears in the document', (b) => { b.document += '\nDISPATCHING\n'; }),
  f('document.reference', 'the document reference points nowhere', (b) => { b.manifest['document'] = 'spec/NOPE.md'; }),
  f('baseline.stateEnum', 'the baseline state leaves the enum', (b) => { R(b, 'reviewed_baseline')['state'] = 'null'; }),
  f('baseline.notEstablishedCarriesNoTuple', 'a not-established baseline carries a tuple', (b) => { R(b, 'reviewed_baseline')['tuple'] = {}; }),
  f('baseline.tupleComplete', 'an established baseline has an empty component', (b) => {
    R(b, 'reviewed_baseline')['state'] = 'ESTABLISHED';
    R(b, 'reviewed_baseline')['tuple'] = { repository_identity: '' };
  }),
  f('baseline.componentSet', 'a baseline component is dropped', (b) => { L(b, 'baseline_tuple_components').pop(); }),
  f('reviewTuple.componentSet', 'the merge-base leaves the review tuple', (b) => {
    b.manifest['review_tuple_components'] = L(b, 'review_tuple_components').filter((x) => x !== 'merge_base_sha');
  }),
  f('reviewTuple.invalidatesVerdict', 'a changed tuple stops invalidating the verdict', (b) => { b.manifest['review_tuple_change_invalidates_verdict'] = false; }),
  f('proofClasses.idSet', 'a proof class is renamed', (b) => { (L(b, 'proof_classes')[0] as Record<string, unknown>)['id'] = 'Z'; }),
  f('proofClasses.semanticNotMechanical', 'semantic authority is made mechanical', (b) => { (L(b, 'proof_classes')[2] as Record<string, unknown>)['mechanical'] = true; }),
  f('proofClasses.fieldsPresent', 'a proof class loses its description', (b) => { (L(b, 'proof_classes')[0] as Record<string, unknown>)['proves'] = ''; }),
  f('authorityRoot.count', 'a record leaves the authority root', (b) => { L(b, 'authority_root').pop(); }),
  f('validatorNonGoals.includeConceptCount', 'the concept-counting disclaimer is removed', (b) => {
    b.manifest['validator_non_goals'] = L(b, 'validator_non_goals').filter((x) => !/counting load-bearing/i.test(String(x)));
  }),
  f('validatorNonGoals.includeOwnAuthority', 'the self-authority disclaimer is removed', (b) => {
    b.manifest['validator_non_goals'] = L(b, 'validator_non_goals').filter((x) => !/own authority root/i.test(String(x)));
  }),
  f('caps.values', 'a cap is widened', (b) => { R(b, 'surface_caps')['changed_files'] = 20; }),
  f('caps.countingRules', 'binary files stop failing closed', (b) => { (R(b, 'surface_caps')['counting'] as Record<string, unknown>)['binary_files'] = 'counted as zero'; }),
  f('caps.prohibitedEvasions', 'the evasion list is thinned', (b) => { R(b, 'surface_caps')['prohibited_evasions'] = ['one']; }),
  f('caps.normativePaths', 'a second normative path appears', (b) => { L(b, 'normative_markdown_paths').push('README.md'); }),
  f('concepts.approvedSet', 'a sixth concept appears', (b) => { L(b, 'concepts').push('task lifecycle'); }),
  f('concepts.semanticFlag', 'the concept count is claimed mechanical', (b) => { b.manifest['concept_count_is_semantic_assessment'] = false; }),
  f('severity.vocabulary', 'a severity is invented', (b) => { L(b, 'severity_vocabulary').push('CRITICAL'); }),
  f('severity.criticalMapping', 'CRITICAL becomes its own severity', (b) => { b.manifest['critical_is_recorded_as'] = 'CRITICAL'; }),
  f('disposition.vocabulary', 'a disposition is invented', (b) => { L(b, 'disposition_vocabulary').push('IGNORE'); }),
  f('disposition.noDefault', 'a default disposition appears', (b) => { b.manifest['disposition_default'] = 'ACCEPT'; }),
  f('registry.closed', 'the registry is opened', (b) => { R(b, 'stage_registry')['closed'] = false; }),
  f('registry.stageSequence', 'two stages are swapped', (b) => {
    const s = R(b, 'stage_registry')['stages'] as Record<string, unknown>[];
    const a = s[1]!; s[1] = s[2]!; s[2] = a;
  }),
  f('registry.noInferredCompletion', 'completion may be inferred from existing rows', (b) => { R(b, 'stage_registry')['completion_inferred_from_existing_rows'] = true; }),
  f('budgets.oneRowPerStage', 'a stage loses its budget row', (b) => { L(b, 'budgets').pop(); }),
  f('budgets.exactMap', 'a stage is given a third round', (b) => { stage(b, 'PR-I')['max_completed_verdicts'] = 3; }),
  f('budgets.extensionConsistency', 'an extendable stage is given two base rounds', (b) => {
    const s = stage(b, 'SPEC-A'); s['rounds'] = 2; s['max_completed_verdicts'] = 2;
  }),
  f('extension.ruleCount', 'an extension rule is dropped', (b) => { L(b, 'conditional_extension_rules').pop(); }),
  f('extension.noThirdRound', 'the third-round prohibition is reworded away', (b) => {
    (L(b, 'conditional_extension_rules') as string[])[2] = 'rounds may be added as needed';
  }),
  f('extension.exactNewTuple', 'the conditional round stops naming the new tuple', (b) => {
    (L(b, 'conditional_extension_rules') as string[])[1] = 'the conditional round reviews the change';
  }),
  f('extension.noCarryForward', 'an old verdict may carry forward', (b) => {
    (L(b, 'conditional_extension_rules') as string[])[5] = 'a prior verdict may be reused';
  }),
  f('stopRules.idSet', 'a stop rule disappears', (b) => { L(b, 'stop_rules').pop(); }),
  f('mergeConditions.count', 'the merge conditions are thinned', (b) => { b.manifest['merge_conditions'] = ['green']; }),
  f('finding.frozenFields', 'severity stops being frozen', (b) => {
    R(b, 'finding_immutability')['frozen_fields'] = ['id', 'text', 'review_tuple', 'content_digest'];
  }),
  f('finding.closureAppendOnly', 'closure may rewrite a finding', (b) => { R(b, 'finding_immutability')['closure_may_rewrite_finding'] = true; }),
  f('closure.routeSet', 'a closure route disappears', (b) => { L(b, 'closure_routes').pop(); }),
  f('closure.semanticNeedsNoOracle', 'semantic closure is made to need an oracle', (b) => {
    (L(b, 'closure_routes')[2] as Record<string, unknown>)['executable_oracle_required'] = true;
  }),
  f('closure.semanticRequirements', 'the reviewer verdict leaves the semantic route', (b) => {
    ((L(b, 'closure_routes')[2] as Record<string, unknown>)['requires'] as unknown[]).pop();
  }),
  f('assertedNotProven.countsAsOpen', 'ASSERTED_NOT_PROVEN stops counting as open', (b) => { R(b, 'asserted_not_proven')['counts_as'] = 'closed'; }),
  f('security.evidenceForms', 'the safe evidence forms are thinned', (b) => { b.manifest['security_safe_evidence_forms'] = ['a']; }),
  f('security.publicTextRule', 'public text may restate a payload', (b) => { b.manifest['public_text_rule'] = 'anything goes'; }),
  f('ci.requirementSet', 'the explicit head checkout requirement is removed', (b) => {
    b.manifest['ci_requirements'] = L(b, 'ci_requirements').filter((x) => !/head\.sha/.test(String(x)));
  }),
  f('capacity.value', 'capacity is raised', (b) => { R(b, 'reviewer_capacity')['value'] = 2; }),
  f('capacity.inFlight', 'capacity is measured in claim records', (b) => { R(b, 'reviewer_capacity')['measured_in'] = 'active claim records'; }),
  f('capacity.failsClosed', 'a provider without a probe stops failing closed', (b) => { R(b, 'reviewer_capacity')['no_probe_no_cancel'] = 'capacity is released'; }),
  f('capacity.independence', 'reviewer independence is dropped', (b) => { R(b, 'reviewer_capacity')['independence'] = 'anyone may review'; }),
  f('gates.idSet', 'a gate is renamed', (b) => { (L(b, 'gates')[1] as Record<string, unknown>)['id'] = 'phase_one_a'; }),
  f('gates.nonWaivable', 'a phase gate becomes waivable', (b) => { (L(b, 'gates')[0] as Record<string, unknown>)['waivable'] = true; }),
  f('gates.rowExistenceInsufficient', 'a decision row alone satisfies Phase 1A', (b) => { (L(b, 'gates')[1] as Record<string, unknown>)['row_existence_satisfies'] = true; }),
  f('gates.phase0AllStages', 'Phase 0 stops requiring every stage', (b) => { (L(b, 'gates')[0] as Record<string, unknown>)['false_until_all_stages_complete'] = false; }),
  f('nonWaivable.count', 'a non-waivable subject is removed', (b) => { L(b, 'non_waivable').pop(); }),
  f('nonWaivable.unmarkedDefault', 'unmarked rules become waivable', (b) => { b.manifest['unmarked_is_waivable'] = true; }),
  f('order.stepCount', 'a step leaves the per-stage order', (b) => { (R(b, 'order')['per_stage'] as unknown[]).pop(); }),
  f('order.noOverlap', 'a checkpoint may overlap its implementation', (b) => { R(b, 'order')['overlap_permitted'] = true; }),
  f('order.concurrency', 'two stages may be open at once', (b) => { R(b, 'order')['concurrent_open_stages'] = 2; }),
  f('order.nextStageDerived', 'a pull request may declare itself next', (b) => { R(b, 'order')['next_stage_self_declared'] = true; }),
  f('superseded.heads', 'a superseded head is changed', (b) => { (L(b, 'superseded_pull_requests')[0] as Record<string, unknown>)['head'] = '0'.repeat(40); }),
  f('superseded.states', 'a superseded PR may be merged', (b) => { (L(b, 'superseded_pull_requests')[0] as Record<string, unknown>)['required_state'] = 'anything'; }),
  f('superseded.separateAuthorisation', 'closure stops needing its own authorisation', (b) => { b.manifest['superseded_closure_requires_separate_authorisation'] = false; }),
  f('assets.classSet', 'a disposition class is invented', (b) => { L(b, 'asset_disposition_classes').push('KEEP_BECAUSE_EXPENSIVE'); }),
  f('assets.rules', 'the disposition rules are thinned', (b) => { b.manifest['asset_disposition_rules'] = ['one']; }),
  f('provider.noOrderingAssumption', 'a provider is assumed ordered', (b) => { b.manifest['provider_ordering_assumption'] = 'check-run ids increase'; }),
  f('lexicalGuard.honestScope', 'the lexical guard claims to prove scope', (b) => { R(b, 'lexical_guard')['proves_absence_of_domain_design'] = true; }),
  f('decisions.approvedSet', 'a deferred decision is quietly approved', (b) => {
    (L(b, 'decisions').find((d) => (d as { id: string }).id === 'D21') as Record<string, unknown>)['state'] = 'APPROVED';
  }),
  f('decisions.deferredSet', 'a deferred decision disappears', (b) => {
    b.manifest['decisions'] = L(b, 'decisions').filter((d) => (d as { id: string }).id !== 'D13');
  }),
  f('decisions.stateEnum', 'a decision takes an illegal state', (b) => {
    (L(b, 'decisions')[0] as Record<string, unknown>)['state'] = 'PROBABLY';
  }),
  f('decisions.d32Option', 'D32 loses its recorded option', (b) => {
    delete (L(b, 'decisions').find((d) => (d as { id: string }).id === 'D32') as Record<string, unknown>)['option'];
  }),
  f('decisions.deferredOwners', 'a deferred decision loses its owner', (b) => {
    delete (L(b, 'decisions').find((d) => (d as { id: string }).id === 'D24') as Record<string, unknown>)['decided_by'];
  }),
];

describe('every predicate can fail', () => {
  for (const fx of fixtures) {
    it(`${fx.predicate}: ${fx.why}`, () => {
      const b = clone();
      fx.mutate(b);
      expect(runChecks(b).map((p) => p.predicate)).toContain(fx.predicate);
    });
  }

  it('covers every declared predicate', () => {
    const covered = new Set(fixtures.map((x) => x.predicate));
    expect(PREDICATES.filter((p) => !covered.has(p))).toEqual([]);
  });

  it('leaves the pristine bundle clean, so the fixtures are what turn the checks red', () => {
    expect(runChecks(clone())).toEqual([]);
  });
});
