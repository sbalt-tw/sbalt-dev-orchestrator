// Constitution validator.
//
// Class A (structural validation) and class B (change detection) only. It does not, and
// may not, claim that any statement in the constitution is correct — see CONSTITUTION.md
// §1.3. Expected values live here, in code, and are never read out of the manifest being
// checked; but code in the same pull request is not an authority root either, which is why
// §1.2 requires an external binding before any baseline is recorded.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAILURE_CODES = [
  'MANIFEST_MISSING', 'MANIFEST_MALFORMED', 'DOCUMENT_MISSING',
  'PROOF_CLASSES', 'AUTHORITY_ROOT', 'VALIDATOR_NON_GOALS',
  'SURFACE_CAPS', 'SEVERITY_VOCABULARY', 'DISPOSITION_DEFAULT',
  'BUDGETS', 'SINGLE_ROUND_EXTENSION', 'STOP_RULES', 'MERGE_CONDITIONS',
  'CLOSURE_CONTRACT', 'SECURITY_EVIDENCE', 'REVIEWER_CAPACITY',
  'GATES', 'NON_WAIVABLE', 'ORDER', 'SUPERSEDED_PRS',
  'ASSET_DISPOSITION', 'PROVIDER_ORDERING', 'DECISION_LEDGER',
  'CONCEPT_CAP', 'BASELINE_UNBOUND', 'DOMAIN_DESIGN_PRESENT',
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];
export interface Problem { code: FailureCode; detail: string }

export interface Bundle {
  root: string;
  manifest: Record<string, unknown>;
  document: string;
  present: { manifest: boolean; document: boolean; parsed: boolean };
}

const EXPECT = {
  caps: { changed_files: 8, handwritten_normative_lines: 700, total_reviewed_diff_lines: 1500, load_bearing_concepts: 5 },
  severities: ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'],
  dispositions: ['FIX', 'ACCEPT', 'DEFER'],
  extendable: ['SPEC-A', 'SPEC-C', 'SPEC-E', 'SPEC-G', 'SPEC-H', 'SPEC-I', 'PR-I'],
  stopRules: ['SR-1', 'SR-2', 'SR-3'],
  gates: ['phase0_completion', 'phase1a_entry'],
  approved: ['D20', 'D26', 'D27', 'D28', 'D29', 'D30', 'D32'],
  deferred: ['D21', 'D22', 'D23', 'D24', 'D25', 'D31', 'D12', 'D13', 'D14'],
  supersededHeads: ['428ae75e91fa1dd23c371d5f7af745aba0bec7fd', '0488bfdecab2544107890316d2edc671913f8132'],
  assetClasses: ['REUSE_AS_IS', 'REWRITE', 'DEMOTE', 'HISTORICAL_EVIDENCE_ONLY'],
  // Tokens that would only appear if domain design had leaked into a governance document.
  domainTokens: ['DISPATCHING', 'redemption_key', 'evidence_snapshot_ref', 'worker_dispatch',
    'CREATE TABLE', 'ALTER TABLE', 'schema_version', 'use_limit'],
} as const;

export function repoRoot(): string {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
}

export function loadBundle(root: string = repoRoot()): Bundle {
  const manifestPath = join(root, 'spec', 'manifests', 'constitution.json');
  const documentPath = join(root, 'spec', 'CONSTITUTION.md');
  const present = { manifest: existsSync(manifestPath), document: existsSync(documentPath), parsed: false };
  let manifest: Record<string, unknown> = {};
  if (present.manifest) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        manifest = parsed as Record<string, unknown>;
        present.parsed = true;
      }
    } catch { /* reported as MANIFEST_MALFORMED below */ }
  }
  const document = present.document ? readFileSync(documentPath, 'utf8') : '';
  return { root, manifest, document, present };
}

const sortJoin = (xs: readonly unknown[]): string => [...xs].map(String).sort().join(',');

export function runChecks(b: Bundle): Problem[] {
  const out: Problem[] = [];
  const push = (code: FailureCode, detail: string) => out.push({ code, detail });
  const m = b.manifest;
  const arr = (k: string): unknown[] => (Array.isArray(m[k]) ? (m[k] as unknown[]) : []);
  const obj = (k: string): Record<string, unknown> =>
    (m[k] !== null && typeof m[k] === 'object' && !Array.isArray(m[k]) ? (m[k] as Record<string, unknown>) : {});

  if (!b.present.manifest) push('MANIFEST_MISSING', 'spec/manifests/constitution.json');
  else if (!b.present.parsed) push('MANIFEST_MALFORMED', 'spec/manifests/constitution.json does not parse as an object');
  if (!b.present.document || b.document.trim().length === 0) push('DOCUMENT_MISSING', 'spec/CONSTITUTION.md');
  if (!b.present.parsed) return out;

  // --- class A -------------------------------------------------------------------------
  const classes = arr('proof_classes') as { id?: string; mechanical?: boolean }[];
  if (sortJoin(classes.map((c) => c.id ?? '')) !== 'A,B,C') push('PROOF_CLASSES', `ids are ${classes.map((c) => c.id).join(',')}`);
  if (classes.find((c) => c.id === 'C')?.mechanical !== false) push('PROOF_CLASSES', 'class C is not marked non-mechanical');

  if (arr('authority_root').length !== 4) push('AUTHORITY_ROOT', `${arr('authority_root').length} records, expected 4`);
  if (arr('validator_non_goals').length < 5) push('VALIDATOR_NON_GOALS', 'fewer than five non-goals are declared');

  const caps = obj('surface_caps');
  for (const [k, v] of Object.entries(EXPECT.caps)) {
    if (caps[k] !== v) push('SURFACE_CAPS', `${k} is ${String(caps[k])}, expected ${v}`);
  }
  if (caps['changed_files_include_generated'] !== true) push('SURFACE_CAPS', 'generated files are excluded from the file cap');
  if (sortJoin((caps['total_diff_exclusions'] as unknown[]) ?? []) !== 'lockfile') push('SURFACE_CAPS', 'the total diff excludes more than a lockfile');
  if (((caps['prohibited_evasions'] as unknown[]) ?? []).length < 3) push('SURFACE_CAPS', 'the prohibited evasions are not listed');

  if (sortJoin(arr('severity_vocabulary')) !== sortJoin(EXPECT.severities)) push('SEVERITY_VOCABULARY', 'the severity vocabulary is not the closed set');
  if (m['critical_is_recorded_as'] !== 'BLOCKER') push('SEVERITY_VOCABULARY', 'CRITICAL is not recorded as BLOCKER');
  if (sortJoin(arr('disposition_vocabulary')) !== sortJoin(EXPECT.dispositions)) push('DISPOSITION_DEFAULT', 'the disposition vocabulary is not the closed set');
  if (m['disposition_default'] !== null) push('DISPOSITION_DEFAULT', `a default disposition of ${String(m['disposition_default'])} is declared`);

  const budgets = arr('budgets') as { target?: string; completed_verdict_rounds?: number; extendable_once?: boolean }[];
  if (budgets.length < 13) push('BUDGETS', `${budgets.length} budgets declared`);
  for (const bud of budgets) {
    const rounds = bud.completed_verdict_rounds;
    if (typeof rounds !== 'number' || rounds < 1 || rounds > 3) push('BUDGETS', `${String(bud.target)} has ${String(rounds)} rounds`);
    if (typeof bud.extendable_once !== 'boolean') push('BUDGETS', `${String(bud.target)} does not state extendability`);
    if (bud.extendable_once === true && rounds !== 1) push('BUDGETS', `${String(bud.target)} is extendable but is not a single-round target`);
  }

  const ext = obj('single_round_extension');
  if (ext['authority'] !== 'D32 option B') push('SINGLE_ROUND_EXTENSION', `authority is ${String(ext['authority'])}`);
  if (sortJoin((ext['applies_to'] as unknown[]) ?? []) !== sortJoin(EXPECT.extendable)) push('SINGLE_ROUND_EXTENSION', 'the extension does not apply to exactly the single-round targets');
  const extRules = ((ext['rules'] as string[]) ?? []).join(' ');
  if (((ext['rules'] as unknown[]) ?? []).length !== 6) push('SINGLE_ROUND_EXTENSION', 'the extension does not state all six rules');
  if (!/no third round/i.test(extRules)) push('SINGLE_ROUND_EXTENSION', 'the extension does not forbid a third round');
  if (!/exact new head/i.test(extRules)) push('SINGLE_ROUND_EXTENSION', 'the extension does not require the exact new head');
  if (!/never carries to the new head/i.test(extRules)) push('SINGLE_ROUND_EXTENSION', 'the extension does not forbid carrying an old verdict forward');

  if (sortJoin((arr('stop_rules') as { id?: string }[]).map((r) => r.id ?? '')) !== sortJoin(EXPECT.stopRules)) push('STOP_RULES', 'the stop rules are not SR-1 to SR-3');
  if (arr('merge_conditions').length < 4) push('MERGE_CONDITIONS', 'fewer than four merge conditions');

  const closure = obj('closure_contract');
  if (((closure['requirements'] as unknown[]) ?? []).length < 5) push('CLOSURE_CONTRACT', 'fewer than five closure requirements');
  if (closure['self_assertion_is_evidence'] !== false) push('CLOSURE_CONTRACT', 'self-assertion is admitted as evidence');
  if (closure['asserted_not_proven_counts_as'] !== 'open') push('CLOSURE_CONTRACT', 'ASSERTED_NOT_PROVEN is not counted as open');
  if (closure['semantic_gap_decided_by'] !== 'Founder') push('CLOSURE_CONTRACT', 'a semantic gap is not decided by the Founder');
  if (((closure['security_safe_evidence_forms'] as unknown[]) ?? []).length < 5) push('SECURITY_EVIDENCE', 'fewer than five safe evidence forms');
  if (!/never restate a security payload/i.test(String(closure['public_text_rule'] ?? ''))) push('SECURITY_EVIDENCE', 'public text is not forbidden from restating a payload');

  const cap = obj('reviewer_capacity');
  if (cap['value'] !== 1) push('REVIEWER_CAPACITY', `capacity is ${String(cap['value'])}`);
  if (!/in-flight/i.test(String(cap['measured_in'] ?? ''))) push('REVIEWER_CAPACITY', 'capacity is not measured in in-flight invocations');
  if (!/fails closed/i.test(String(cap['no_probe_no_cancel'] ?? ''))) push('REVIEWER_CAPACITY', 'a provider without probe or cancellation does not fail closed');
  if (!/distinct/i.test(String(cap['independence'] ?? ''))) push('REVIEWER_CAPACITY', 'reviewer independence is not stated');

  const gates = arr('gates') as { id?: string; waivable?: boolean; row_existence_satisfies?: boolean }[];
  if (sortJoin(gates.map((g) => g.id ?? '')) !== sortJoin(EXPECT.gates)) push('GATES', `gates are ${gates.map((g) => g.id).join(',')}`);
  for (const g of gates) if (g.waivable !== false) push('GATES', `${String(g.id)} is not marked non-waivable`);
  if (gates.find((g) => g.id === 'phase1a_entry')?.row_existence_satisfies !== false) push('GATES', 'a decision row alone satisfies the Phase 1A gate');

  if (arr('non_waivable').length !== 10) push('NON_WAIVABLE', `${arr('non_waivable').length} non-waivable subjects, expected 10`);
  if (m['unmarked_is_waivable'] !== false) push('NON_WAIVABLE', 'unmarked rules are waivable by default');

  const order = obj('order');
  if (((order['per_domain'] as unknown[]) ?? []).length !== 5) push('ORDER', 'the per-domain order is not five steps');
  if (order['overlap_permitted'] !== false) push('ORDER', 'a checkpoint may overlap its implementation');
  if (order['concurrent_open_targets'] !== 1) push('ORDER', `${String(order['concurrent_open_targets'])} targets may be open at once`);
  if (order['checkpoint_consumes_implementation_slot'] !== false) push('ORDER', 'a checkpoint consumes the implementation slot');
  if (order['checkpoint_count_is_invariant'] !== false) push('ORDER', 'the checkpoint count is treated as an invariant');

  const superseded = arr('superseded_pull_requests') as { number?: number; head?: string; required_state?: string }[];
  if (sortJoin(superseded.map((p) => p.head ?? '')) !== sortJoin(EXPECT.supersededHeads)) push('SUPERSEDED_PRS', 'the superseded heads are not the two frozen heads');
  for (const p of superseded) if (!/OPEN \/ UNMERGED/.test(String(p.required_state))) push('SUPERSEDED_PRS', `PR #${String(p.number)} is not required to stay open and unmerged`);
  if (m['superseded_closure_requires_separate_authorisation'] !== true) push('SUPERSEDED_PRS', 'closure does not require a separate authorisation');

  if (sortJoin(arr('asset_disposition_classes')) !== sortJoin(EXPECT.assetClasses)) push('ASSET_DISPOSITION', 'the disposition classes are not the closed set');
  if (arr('asset_disposition_rules').length < 3) push('ASSET_DISPOSITION', 'fewer than three disposition rules');

  const ordering = String(m['provider_ordering_assumption'] ?? '');
  if (!/^none/i.test(ordering) || !/contract/i.test(ordering)) push('PROVIDER_ORDERING', 'a provider ordering assumption is made, or no contract is required');

  const decisions = arr('decisions') as { id?: string; state?: string; option?: string }[];
  const approved = decisions.filter((d) => d.state === 'APPROVED').map((d) => d.id ?? '');
  const deferred = decisions.filter((d) => d.state === 'DEFERRED').map((d) => d.id ?? '');
  if (sortJoin(approved) !== sortJoin(EXPECT.approved)) push('DECISION_LEDGER', `approved set is ${approved.join(',')}`);
  if (sortJoin(deferred) !== sortJoin(EXPECT.deferred)) push('DECISION_LEDGER', `deferred set is ${deferred.join(',')}`);
  for (const d of decisions) {
    if (d.state !== 'APPROVED' && d.state !== 'DEFERRED') push('DECISION_LEDGER', `${String(d.id)} is ${String(d.state)}`);
  }
  if (decisions.find((d) => d.id === 'D32')?.option !== 'B') push('DECISION_LEDGER', 'D32 does not record option B');

  const concepts = arr('concepts');
  if (concepts.length > EXPECT.caps.load_bearing_concepts) push('CONCEPT_CAP', `${concepts.length} concepts, cap is ${EXPECT.caps.load_bearing_concepts}`);

  // --- class B -------------------------------------------------------------------------
  const baseline = m['reviewed_baseline'];
  if (baseline !== null) {
    const bound = baseline !== null && typeof baseline === 'object' ? (baseline as Record<string, unknown>) : {};
    if (typeof bound['decision_id'] !== 'string' || typeof bound['merge_commit'] !== 'string') {
      push('BASELINE_UNBOUND', 'a baseline is recorded without an external binding: it needs the approving decision id and the merge commit that landed it');
    }
  }

  // --- scope guard ---------------------------------------------------------------------
  for (const token of EXPECT.domainTokens) {
    if (b.document.includes(token)) push('DOMAIN_DESIGN_PRESENT', `the constitution contains the domain token "${token}"`);
  }

  return out;
}

function main(): void {
  const bundle = loadBundle();
  const problems = runChecks(bundle);
  const m = bundle.manifest;
  console.log('SBALT Development Orchestrator — constitution validator (class A and B only)');
  console.log(`  decisions   ${(m['decisions'] as unknown[] | undefined)?.length ?? 0}`);
  console.log(`  budgets     ${(m['budgets'] as unknown[] | undefined)?.length ?? 0}`);
  console.log(`  concepts    ${(m['concepts'] as unknown[] | undefined)?.length ?? 0} of ${EXPECT.caps.load_bearing_concepts}`);
  console.log(`  baseline    ${m['reviewed_baseline'] === null ? 'null — no reviewed baseline exists yet' : 'recorded'}`);
  console.log('');
  if (problems.length === 0) {
    console.log('OK — structurally valid. This says nothing about whether the constitution is right.');
    return;
  }
  console.error(`FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  [${p.code}] ${p.detail}`);
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith('constitution.ts')) main();
