// Constitution validator.
//
// Class A (structural validation) and class B (change detection) only. It cannot and does
// not claim that any statement in the constitution is correct, nor that the declared
// concept count is the real one — see CONSTITUTION.md §1.4 and §2.4. Expected values live
// here rather than in the manifest being checked; this file is still editable by the same
// pull request, so it is a drift guard, not an authority root (§1.2).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PREDICATES = [
  'manifest.present', 'manifest.parses', 'manifest.schema', 'manifest.unknownKeys',
  'document.present', 'document.lexicalGuard', 'document.reference',
  'baseline.stateEnum', 'baseline.notEstablishedCarriesNoTuple', 'baseline.tupleComplete',
  'baseline.componentSet', 'reviewTuple.componentSet', 'reviewTuple.invalidatesVerdict',
  'proofClasses.idSet', 'proofClasses.semanticNotMechanical', 'proofClasses.fieldsPresent',
  'authorityRoot.count', 'validatorNonGoals.includeConceptCount',
  'validatorNonGoals.includeOwnAuthority',
  'caps.values', 'caps.countingRules', 'caps.prohibitedEvasions', 'caps.normativePaths',
  'concepts.approvedSet', 'concepts.semanticFlag',
  'severity.vocabulary', 'severity.criticalMapping', 'disposition.vocabulary',
  'disposition.noDefault',
  'registry.closed', 'registry.stageSequence', 'registry.noInferredCompletion',
  'budgets.oneRowPerStage', 'budgets.exactMap', 'budgets.extensionConsistency',
  'extension.ruleCount', 'extension.noThirdRound', 'extension.exactNewTuple',
  'extension.noCarryForward',
  'stopRules.idSet', 'mergeConditions.count',
  'finding.frozenFields', 'finding.closureAppendOnly',
  'closure.routeSet', 'closure.semanticNeedsNoOracle', 'closure.semanticRequirements',
  'assertedNotProven.countsAsOpen',
  'security.evidenceForms', 'security.publicTextRule',
  'ci.requirementSet',
  'capacity.value', 'capacity.inFlight', 'capacity.failsClosed', 'capacity.independence',
  'gates.idSet', 'gates.nonWaivable', 'gates.rowExistenceInsufficient',
  'gates.phase0AllStages',
  'nonWaivable.count', 'nonWaivable.unmarkedDefault',
  'order.stepCount', 'order.noOverlap', 'order.concurrency', 'order.nextStageDerived',
  'superseded.heads', 'superseded.states', 'superseded.separateAuthorisation',
  'assets.classSet', 'assets.rules',
  'provider.noOrderingAssumption',
  'lexicalGuard.honestScope',
  'decisions.approvedSet', 'decisions.deferredSet', 'decisions.stateEnum',
  'decisions.d32Option', 'decisions.deferredOwners',
] as const;

export type Predicate = (typeof PREDICATES)[number];
export interface Problem { predicate: Predicate; detail: string }

export interface Bundle {
  root: string;
  manifest: Record<string, unknown>;
  document: string;
  present: { manifest: boolean; document: boolean; parsed: boolean };
}

type Kind = 'string' | 'object' | 'array' | 'boolean' | 'number';
const SCHEMA: Record<string, Kind> = {
  manifest_version: 'number', document: 'string', scope: 'string',
  reviewed_baseline: 'object', baseline_tuple_components: 'array',
  review_tuple_components: 'array', review_tuple_change_invalidates_verdict: 'boolean',
  proof_classes: 'array', authority_root: 'array', validator_non_goals: 'array',
  normative_markdown_paths: 'array', surface_caps: 'object', concepts: 'array',
  concept_count_is_semantic_assessment: 'boolean', severity_vocabulary: 'array',
  critical_is_recorded_as: 'string', disposition_vocabulary: 'array',
  disposition_default: 'object', stage_registry: 'object', budgets: 'array',
  conditional_extension_rules: 'array', stop_rules: 'array', merge_conditions: 'array',
  finding_immutability: 'object', closure_routes: 'array', asserted_not_proven: 'object',
  security_safe_evidence_forms: 'array', public_text_rule: 'string',
  ci_requirements: 'array', reviewer_capacity: 'object', gates: 'array',
  non_waivable: 'array', unmarked_is_waivable: 'boolean', order: 'object',
  superseded_pull_requests: 'array', superseded_closure_requires_separate_authorisation: 'boolean',
  asset_disposition_classes: 'array', asset_disposition_rules: 'array',
  provider_ordering_assumption: 'string', lexical_guard: 'object', decisions: 'array',
};

const STAGES = ['PR-C0', 'SPEC-A', 'PR-A', 'SPEC-B', 'PR-B', 'SPEC-C', 'PR-C', 'SPEC-D',
  'PR-D', 'SPEC-E', 'PR-E', 'SPEC-F', 'PR-F', 'SPEC-G', 'PR-G', 'SPEC-H', 'PR-H',
  'SPEC-I', 'PR-I'];
const EXTENDABLE = ['SPEC-A', 'SPEC-C', 'SPEC-E', 'SPEC-G', 'SPEC-H', 'SPEC-I', 'PR-I'];
const THREE_ROUND = ['PR-F'];
const CONCEPTS = ['authority and proof model', 'exact review identity and CI identity',
  'finding closure and review budget', 'phase registry, gates and ordering',
  'surface boundaries'];
const APPROVED = ['D20', 'D26', 'D27', 'D28', 'D29', 'D30', 'D32', 'D33', 'D34', 'D35', 'D36', 'D37'];
const DEFERRED_OWNERS: Record<string, string> = {
  D21: 'SPEC-B', D22: 'SPEC-B', D23: 'SPEC-B', D24: 'SPEC-D', D25: 'SPEC-D', D31: 'SPEC-F',
  D12: 'Founder, beyond Phase 0', D13: 'Phase 1A entry gate', D14: 'Phase 1A entry gate',
};
const HEADS = ['428ae75e91fa1dd23c371d5f7af745aba0bec7fd', '0488bfdecab2544107890316d2edc671913f8132'];
const CAPS = { changed_files: 8, handwritten_normative_lines: 700, total_reviewed_diff_lines: 1500, load_bearing_concepts: 5 };
const COUNTING_KEYS = ['base_and_head_from', 'changed_files', 'handwritten_normative_lines',
  'total_reviewed_diff_lines', 'binary_files', 'per_file_line_cap'];

export function repoRoot(): string {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
}

export function loadBundle(root: string = repoRoot()): Bundle {
  const mp = join(root, 'spec', 'manifests', 'constitution.json');
  const dp = join(root, 'spec', 'CONSTITUTION.md');
  const present = { manifest: existsSync(mp), document: existsSync(dp), parsed: false };
  let manifest: Record<string, unknown> = {};
  if (present.manifest) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(mp, 'utf8'));
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        manifest = parsed as Record<string, unknown>;
        present.parsed = true;
      }
    } catch { /* reported by manifest.parses */ }
  }
  return { root, manifest, document: present.document ? readFileSync(dp, 'utf8') : '', present };
}

/** Set equality without joining: length, uniqueness and membership both ways. */
function sameSet(actual: readonly unknown[], expected: readonly string[]): boolean {
  const a = actual.map(String);
  if (a.length !== expected.length) return false;
  if (new Set(a).size !== a.length) return false;
  return expected.every((e) => a.includes(e)) && a.every((x) => expected.includes(x));
}
const kindOf = (v: unknown): Kind | 'other' =>
  Array.isArray(v) ? 'array'
    : v === null ? 'object'
      : typeof v === 'object' ? 'object'
        : typeof v === 'string' ? 'string'
          : typeof v === 'boolean' ? 'boolean'
            : typeof v === 'number' ? 'number' : 'other';

export function runChecks(b: Bundle): Problem[] {
  const out: Problem[] = [];
  const bad = (predicate: Predicate, detail: string) => out.push({ predicate, detail });
  const m = b.manifest;
  const A = (k: string): unknown[] => (Array.isArray(m[k]) ? (m[k] as unknown[]) : []);
  const O = (k: string): Record<string, unknown> =>
    (m[k] !== null && typeof m[k] === 'object' && !Array.isArray(m[k]) ? (m[k] as Record<string, unknown>) : {});
  const S = (v: unknown): string => (typeof v === 'string' ? v : '');

  // --- document checks run whatever the manifest does ---------------------------------
  if (!b.present.document || b.document.trim().length === 0) bad('document.present', 'spec/CONSTITUTION.md is missing or empty');
  const guard = O('lexical_guard');
  const tokens = (guard['tokens'] as string[] | undefined) ?? [];
  for (const t of tokens) if (b.document.includes(t)) bad('document.lexicalGuard', `the document contains the banned literal "${t}"`);
  if (S(m['document']) !== '' && !existsSync(join(b.root, S(m['document'])))) bad('document.reference', `${S(m['document'])} does not exist`);

  if (!b.present.manifest) { bad('manifest.present', 'spec/manifests/constitution.json is missing'); return out; }
  if (!b.present.parsed) { bad('manifest.parses', 'the manifest does not parse as a JSON object'); return out; }

  // --- closed schema ------------------------------------------------------------------
  for (const [key, kind] of Object.entries(SCHEMA)) {
    if (!(key in m)) bad('manifest.schema', `required key "${key}" is absent`);
    else if (key !== 'disposition_default' && kindOf(m[key]) !== kind) bad('manifest.schema', `"${key}" is ${kindOf(m[key])}, expected ${kind}`);
    else if (kind === 'string' && S(m[key]).trim() === '') bad('manifest.schema', `"${key}" is empty`);
  }
  for (const key of Object.keys(m)) if (!(key in SCHEMA)) bad('manifest.unknownKeys', `unknown top-level key "${key}"`);

  // --- baseline, class B --------------------------------------------------------------
  const base = O('reviewed_baseline');
  const state = S(base['state']);
  if (state !== 'NOT_ESTABLISHED' && state !== 'ESTABLISHED') bad('baseline.stateEnum', `baseline state is "${state}"`);
  if (state === 'NOT_ESTABLISHED' && base['tuple'] !== null) bad('baseline.notEstablishedCarriesNoTuple', 'a not-established baseline carries a tuple');
  if (state === 'ESTABLISHED') {
    const t = (base['tuple'] !== null && typeof base['tuple'] === 'object' ? base['tuple'] as Record<string, unknown> : {});
    for (const c of A('baseline_tuple_components')) {
      if (S(t[String(c)]).trim() === '') bad('baseline.tupleComplete', `established baseline is missing a non-empty ${String(c)}`);
    }
  }
  if (!sameSet(A('baseline_tuple_components'), ['repository_identity', 'pr_number', 'review_base_sha',
    'merge_base_sha', 'reviewed_head_sha', 'reviewed_head_tree_sha', 'diff_identity',
    'reviewer_verdict_identity', 'founder_decision_reference', 'merge_commit_sha', 'merged_tree_sha'])) {
    bad('baseline.componentSet', 'the baseline tuple components are not the eleven approved ones');
  }
  if (!sameSet(A('review_tuple_components'), ['repository', 'pull_request', 'base_sha', 'merge_base_sha',
    'head_sha', 'head_tree_sha', 'diff_identity', 'ci_evidence_identity', 'reviewer_verdict_identity'])) {
    bad('reviewTuple.componentSet', 'the review tuple components are not the nine approved ones');
  }
  if (m['review_tuple_change_invalidates_verdict'] !== true) bad('reviewTuple.invalidatesVerdict', 'a changed tuple does not invalidate the verdict');

  // --- proof classes ------------------------------------------------------------------
  const pc = A('proof_classes') as { id?: string; name?: string; proves?: string; mechanical?: boolean }[];
  if (!sameSet(pc.map((c) => c.id ?? ''), ['A', 'B', 'C'])) bad('proofClasses.idSet', 'the proof classes are not exactly A, B and C');
  if (pc.find((c) => c.id === 'C')?.mechanical !== false) bad('proofClasses.semanticNotMechanical', 'semantic authority is marked mechanical');
  for (const c of pc) if (S(c.name).trim() === '' || S(c.proves).trim() === '' || typeof c.mechanical !== 'boolean') bad('proofClasses.fieldsPresent', `proof class ${String(c.id)} is incomplete`);
  if (A('authority_root').length !== 4) bad('authorityRoot.count', `${A('authority_root').length} authority records, expected 4`);
  const goals = A('validator_non_goals').map(String).join(' | ');
  if (!/counting load-bearing concepts/i.test(goals)) bad('validatorNonGoals.includeConceptCount', 'counting concepts is not disclaimed');
  if (!/establishing its own authority root/i.test(goals)) bad('validatorNonGoals.includeOwnAuthority', 'self-authority is not disclaimed');

  // --- caps -----------------------------------------------------------------------------
  const caps = O('surface_caps');
  for (const [k, v] of Object.entries(CAPS)) if (caps[k] !== v) bad('caps.values', `${k} is ${String(caps[k])}, expected ${v}`);
  const counting = (caps['counting'] !== null && typeof caps['counting'] === 'object' ? caps['counting'] as Record<string, unknown> : {});
  for (const k of COUNTING_KEYS) if (S(counting[k]).trim() === '') bad('caps.countingRules', `the counting rule for ${k} is missing`);
  if (!/fail[s]? closed/i.test(S(counting['binary_files']))) bad('caps.countingRules', 'a binary change does not fail closed');
  if (((caps['prohibited_evasions'] as unknown[]) ?? []).length < 4) bad('caps.prohibitedEvasions', 'fewer than four prohibited evasions');
  if (!sameSet(A('normative_markdown_paths'), ['spec/CONSTITUTION.md'])) bad('caps.normativePaths', 'the normative markdown paths are not the enumerated set');
  if (!sameSet(A('concepts'), CONCEPTS)) bad('concepts.approvedSet', 'the declared concepts are not the five approved ones');
  if (m['concept_count_is_semantic_assessment'] !== true) bad('concepts.semanticFlag', 'the concept count is not declared a semantic assessment');

  // --- vocabularies ----------------------------------------------------------------------
  if (!sameSet(A('severity_vocabulary'), ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'])) bad('severity.vocabulary', 'the severity vocabulary is not the closed set');
  if (m['critical_is_recorded_as'] !== 'BLOCKER') bad('severity.criticalMapping', 'CRITICAL is not recorded as BLOCKER');
  if (!sameSet(A('disposition_vocabulary'), ['FIX', 'ACCEPT', 'DEFER'])) bad('disposition.vocabulary', 'the disposition vocabulary is not the closed set');
  if (m['disposition_default'] !== null) bad('disposition.noDefault', `a default disposition of ${String(m['disposition_default'])} is declared`);

  // --- stage registry --------------------------------------------------------------------
  const reg = O('stage_registry');
  if (reg['closed'] !== true) bad('registry.closed', 'the stage registry is not closed');
  if (reg['completion_inferred_from_existing_rows'] !== false) bad('registry.noInferredCompletion', 'completion may be inferred from existing rows');
  const stages = (reg['stages'] as { position?: number; id?: string; kind?: string }[] | undefined) ?? [];
  if (stages.length !== STAGES.length) bad('registry.stageSequence', `${stages.length} stages, expected ${STAGES.length}`);
  STAGES.forEach((id, i) => {
    const s = stages[i];
    if (!s || s.id !== id || s.position !== i + 1) bad('registry.stageSequence', `position ${i + 1} is ${String(s?.id)}@${String(s?.position)}, expected ${id}@${i + 1}`);
  });
  if (new Set(stages.map((s) => s.id)).size !== stages.length) bad('registry.stageSequence', 'a stage id is duplicated');

  // --- budgets, one exact row per stage ---------------------------------------------------
  const budgets = (A('budgets') as { stage?: string; rounds?: number; conditional_extension?: boolean; max_completed_verdicts?: number }[]);
  if (!sameSet(budgets.map((x) => x.stage ?? ''), STAGES)) bad('budgets.oneRowPerStage', 'the budget rows are not exactly one per stage');
  for (const row of budgets) {
    const stage = String(row.stage);
    const wantRounds = THREE_ROUND.includes(stage) ? 3 : EXTENDABLE.includes(stage) ? 1 : 2;
    const wantExt = EXTENDABLE.includes(stage);
    const wantMax = THREE_ROUND.includes(stage) ? 3 : 2;
    if (row.rounds !== wantRounds) bad('budgets.exactMap', `${stage} has ${String(row.rounds)} rounds, expected ${wantRounds}`);
    if (row.conditional_extension !== wantExt) bad('budgets.exactMap', `${stage} extension is ${String(row.conditional_extension)}, expected ${String(wantExt)}`);
    if (row.max_completed_verdicts !== wantMax) bad('budgets.exactMap', `${stage} max is ${String(row.max_completed_verdicts)}, expected ${wantMax}`);
    if (row.conditional_extension === true && (row.rounds !== 1 || row.max_completed_verdicts !== 2)) {
      bad('budgets.extensionConsistency', `${stage} is extendable but is not one round with a maximum of two`);
    }
  }
  const rules = A('conditional_extension_rules').map(String).join(' | ');
  if (A('conditional_extension_rules').length !== 6) bad('extension.ruleCount', 'the conditional extension does not state all six rules');
  if (!/no third round/i.test(rules)) bad('extension.noThirdRound', 'a third round is not forbidden');
  if (!/exact new review tuple/i.test(rules)) bad('extension.exactNewTuple', 'the conditional round is not bound to the exact new tuple');
  if (!/never carries to a new one/i.test(rules)) bad('extension.noCarryForward', 'an old verdict may carry forward');

  if (!sameSet((A('stop_rules') as { id?: string }[]).map((r) => r.id ?? ''), ['SR-1', 'SR-2', 'SR-3'])) bad('stopRules.idSet', 'the stop rules are not SR-1 to SR-3');
  if (A('merge_conditions').length < 4) bad('mergeConditions.count', 'fewer than four merge conditions');

  // --- findings and closure ----------------------------------------------------------------
  const fi = O('finding_immutability');
  if (!sameSet((fi['frozen_fields'] as unknown[]) ?? [], ['id', 'text', 'severity', 'review_tuple', 'content_digest'])) bad('finding.frozenFields', 'the frozen finding fields are not the five approved ones');
  if (fi['closure_is_append_only'] !== true || fi['closure_may_rewrite_finding'] !== false) bad('finding.closureAppendOnly', 'closure may rewrite a finding');
  const routes = (A('closure_routes') as { proof_class?: string; requires?: unknown[]; executable_oracle_required?: boolean }[]);
  if (!sameSet(routes.map((r) => r.proof_class ?? ''), ['A', 'B', 'C'])) bad('closure.routeSet', 'there is not one closure route per proof class');
  const cRoute = routes.find((r) => r.proof_class === 'C');
  if (cRoute?.executable_oracle_required !== false) bad('closure.semanticNeedsNoOracle', 'a semantic closure is made to require an executable oracle');
  if (((cRoute?.requires as unknown[]) ?? []).length !== 4) bad('closure.semanticRequirements', 'the semantic closure route does not state its four requirements');
  const anp = O('asserted_not_proven');
  if (anp['counts_as'] !== 'open' || S(anp['meaning']).trim() === '') bad('assertedNotProven.countsAsOpen', 'ASSERTED_NOT_PROVEN is not defined as an open, class-scoped status');
  if (A('security_safe_evidence_forms').length < 5) bad('security.evidenceForms', 'fewer than five safe evidence forms');
  if (!/never restate a security payload/i.test(S(m['public_text_rule']))) bad('security.publicTextRule', 'public text may restate a payload');

  // --- CI, capacity, gates ------------------------------------------------------------------
  const ci = A('ci_requirements').map(String).join(' | ');
  for (const [needle, label] of [[/checkout github\.event\.pull_request\.head\.sha/i, 'explicit head checkout'],
    [/assert git rev-parse HEAD/i, 'head assertion'], [/merge-base equals the reviewed base/i, 'merge-base assertion'],
    [/head tree sha/i, 'tree evidence'], [/read-only permissions/i, 'least privilege'],
    [/synthetic merge checkout/i, 'no synthetic-merge claim'], [/monotonically ordered/i, 'no provider ordering']] as const) {
    if (!needle.test(ci)) bad('ci.requirementSet', `the CI requirements omit the ${label}`);
  }
  const cap = O('reviewer_capacity');
  if (cap['value'] !== 1) bad('capacity.value', `capacity is ${String(cap['value'])}`);
  if (!/in-flight/i.test(S(cap['measured_in']))) bad('capacity.inFlight', 'capacity is not measured in in-flight invocations');
  if (!/fails closed/i.test(S(cap['no_probe_no_cancel']))) bad('capacity.failsClosed', 'a provider without probe or cancellation does not fail closed');
  if (!/distinct/i.test(S(cap['independence']))) bad('capacity.independence', 'reviewer independence is not stated');
  const gates = (A('gates') as { id?: string; waivable?: boolean; row_existence_satisfies?: boolean; false_until_all_stages_complete?: boolean }[]);
  if (!sameSet(gates.map((g) => g.id ?? ''), ['phase0_completion', 'phase1a_entry'])) bad('gates.idSet', 'the gates are not the two approved ones');
  for (const g of gates) if (g.waivable !== false) bad('gates.nonWaivable', `${String(g.id)} is not non-waivable`);
  if (gates.find((g) => g.id === 'phase1a_entry')?.row_existence_satisfies !== false) bad('gates.rowExistenceInsufficient', 'a decision row alone satisfies the Phase 1A gate');
  if (gates.find((g) => g.id === 'phase0_completion')?.false_until_all_stages_complete !== true) bad('gates.phase0AllStages', 'Phase 0 completion does not require every stage');
  if (A('non_waivable').length !== 10) bad('nonWaivable.count', `${A('non_waivable').length} non-waivable subjects, expected 10`);
  if (m['unmarked_is_waivable'] !== false) bad('nonWaivable.unmarkedDefault', 'unmarked rules are waivable by default');

  // --- order, superseded, assets ---------------------------------------------------------------
  const order = O('order');
  if (((order['per_stage'] as unknown[]) ?? []).length !== 5) bad('order.stepCount', 'the per-stage order is not five steps');
  if (order['overlap_permitted'] !== false) bad('order.noOverlap', 'a checkpoint may overlap its implementation');
  if (order['concurrent_open_stages'] !== 1 || order['checkpoint_consumes_implementation_slot'] !== false) bad('order.concurrency', 'the concurrency rule is wrong');
  if (order['next_stage_self_declared'] !== false || !/registry/i.test(S(order['next_stage_derived_from']))) bad('order.nextStageDerived', 'the next stage is not derived from the closed registry');
  const sup = (A('superseded_pull_requests') as { number?: number; head?: string; required_state?: string }[]);
  if (!sameSet(sup.map((p) => p.head ?? ''), HEADS)) bad('superseded.heads', 'the superseded heads are not the two frozen heads');
  for (const p of sup) if (!/OPEN \/ UNMERGED/.test(S(p.required_state))) bad('superseded.states', `PR #${String(p.number)} is not required to stay open and unmerged`);
  if (m['superseded_closure_requires_separate_authorisation'] !== true) bad('superseded.separateAuthorisation', 'closure does not need a separate authorisation');
  if (!sameSet(A('asset_disposition_classes'), ['REUSE_AS_IS', 'REWRITE', 'DEMOTE', 'HISTORICAL_EVIDENCE_ONLY'])) bad('assets.classSet', 'the disposition classes are not the closed set');
  if (A('asset_disposition_rules').length < 3) bad('assets.rules', 'fewer than three disposition rules');
  const po = S(m['provider_ordering_assumption']);
  if (!/^none/i.test(po) || !/contract/i.test(po)) bad('provider.noOrderingAssumption', 'a provider ordering assumption is made, or no contract is required');
  if (guard['proves_absence_of_domain_design'] !== false || !/narrow/i.test(S(guard['kind']))) bad('lexicalGuard.honestScope', 'the lexical guard overclaims what it proves');

  // --- decisions -------------------------------------------------------------------------------
  const decisions = (A('decisions') as { id?: string; state?: string; option?: string; decided_by?: string }[]);
  if (!sameSet(decisions.filter((d) => d.state === 'APPROVED').map((d) => d.id ?? ''), APPROVED)) bad('decisions.approvedSet', 'the approved decisions are not the approved set');
  if (!sameSet(decisions.filter((d) => d.state === 'DEFERRED').map((d) => d.id ?? ''), Object.keys(DEFERRED_OWNERS))) bad('decisions.deferredSet', 'the deferred decisions are not the deferred set');
  for (const d of decisions) if (d.state !== 'APPROVED' && d.state !== 'DEFERRED') bad('decisions.stateEnum', `${String(d.id)} is ${String(d.state)}`);
  if (decisions.find((d) => d.id === 'D32')?.option !== 'B') bad('decisions.d32Option', 'D32 does not record option B');
  for (const [id, owner] of Object.entries(DEFERRED_OWNERS)) {
    if (decisions.find((d) => d.id === id)?.decided_by !== owner) bad('decisions.deferredOwners', `${id} is not owned by ${owner}`);
  }
  return out;
}

function main(): void {
  const b = loadBundle();
  const problems = runChecks(b);
  const base = (b.manifest['reviewed_baseline'] ?? {}) as Record<string, unknown>;
  console.log('SBALT Development Orchestrator — constitution validator (class A and B only)');
  console.log(`  stages      ${((b.manifest['stage_registry'] as Record<string, unknown> | undefined)?.['stages'] as unknown[] | undefined)?.length ?? 0}`);
  console.log(`  budgets     ${(b.manifest['budgets'] as unknown[] | undefined)?.length ?? 0}`);
  console.log(`  decisions   ${(b.manifest['decisions'] as unknown[] | undefined)?.length ?? 0}`);
  console.log(`  predicates  ${PREDICATES.length}`);
  console.log(`  class B     ${String(base['state'] ?? 'UNKNOWN')} — no change claim is possible while it is NOT_ESTABLISHED`);
  console.log('');
  if (problems.length === 0) {
    console.log('OK — structurally valid. It is not a claim that the constitution is right,');
    console.log('and with no established baseline it is not a claim that anything is unchanged.');
    return;
  }
  console.error(`FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  [${p.predicate}] ${p.detail}`);
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith('constitution.ts')) main();
