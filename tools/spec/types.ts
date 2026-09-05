// Shapes of the specification manifests. This module is part of the specification
// toolchain: it is not runtime code and nothing under src/ may import it.

export type Disposition = 'REQUIRED' | 'FIXED' | 'OPTIONAL' | 'FORBIDDEN';

export interface LoadProblem {
  code: 'DOC_MISSING' | 'DOC_EMPTY' | 'MANIFEST_MISSING' | 'MANIFEST_MALFORMED';
  detail: string;
}

export interface InvariantTest {
  name: string;
  slice: string;
  kind: 'positive' | 'negative';
  asserts: string;
}

export interface Invariant {
  id: string;
  family: string;
  statement: string;
  sharpened: boolean;
  errata: string[];
  decisions: string[];
  owners: {
    normative: string;
    enforcement: string[];
    persistence: string[];
    persistence_note?: string;
    test: string[];
  };
  introducing_slice: string;
  inheriting_slices: string[];
  tests: InvariantTest[];
}

export interface InvariantManifest {
  manifest_version: number;
  census: { invariants: number; families: number };
  families: Record<string, string>;
  invariants: Invariant[];
}

export interface ActionKind {
  title: string;
  canonical_target: string;
  fields: Record<string, Disposition>;
  fixed_values: Record<string, number | string>;
  notes: string;
}

export interface ActionMatrix {
  manifest_version: number;
  dispositions: Disposition[];
  census: { fields: number; action_kinds: number; cells: number; always_required_fields: number };
  fields: { name: string; canonical_form: string }[];
  always_required: string[];
  field_groups: { name: string; members: string[]; applies_to: string[]; rule: string }[];
  kinds: Record<string, ActionKind>;
}

export interface Slice {
  id: string;
  position: number;
  title: string;
  classification: string;
  merge_predecessor: string | null;
  migration: string | null;
  schema_predecessor: string | null;
  schema_note?: string;
  functional_dependencies: string[];
  runtime_dependencies: string[];
  summary: string;
}

export interface SliceManifest {
  manifest_version: number;
  total_order: string[];
  migration_chain: string[];
  slices: Slice[];
}

export interface TriageRow {
  row: number;
  source_head: string;
  source_file: string;
  source_line: number;
  scenario: string;
  invariants: string[];
  disposition: 'KEEP' | 'REWRITE' | 'DROP';
  mapping_basis: 'invariant' | 'slice_local';
  slice_local: { owner_slice: string; named_test: string; why_no_invariant: string } | null;
  rationale: string;
  target_slice: string | null;
  replacement: string | null;
  audit_note: string;
}

export interface TriageManifest {
  manifest_version: number;
  source_head: string;
  source_note: string;
  census: {
    rows: number; KEEP: number; REWRITE: number; DROP: number;
    mapping_basis?: { invariant: number; slice_local: number };
  };
  method: Record<string, string>;
  rows: TriageRow[];
}

export interface Finding {
  id: string;
  round: number;
  severity: string | null;
  title: string;
  invariants: string[];
  disposition: string;
  closed_in: string;
  note?: string;
  severity_note?: string;
}

export interface DebtItem {
  id: string;
  title: string;
  invariants: string[];
  disposition: string;
  owner: string;
  target: string;
  note: string;
  rule?: string;
  exit_condition?: string;
}

export interface Pr0Finding {
  id: string;
  severity: string;
  gap: boolean;
  title: string;
  invariants: string[];
  closed_by: string;
  closure: string;
}

export interface FindingManifest {
  manifest_version: number;
  source_head: string;
  note: string;
  rounds: {
    round: number;
    head: string;
    aggregate: Record<string, number>;
    itemised: number;
    unitemised: number;
    unitemised_debt: string | null;
  }[];
  findings: Finding[];
  carried_debt: DebtItem[];
  pr0_review: {
    pr: number;
    reviewed_base: string;
    rounds: {
      round: number;
      head: string;
      verdict: Record<string, number>;
      itemised: number;
      disposition_authority: string;
      disposition: string;
    }[];
    findings: Pr0Finding[];
  };
}

export interface DecisionRow {
  id: string;
  decision: string;
  state: string;
  amended_by: string[];
  blocks: string[];
  note?: string;
  resolution: {
    decision_id?: string;
    outcome?: string;
    content_ref?: string;
    content_version?: string;
  } | null;
}

export interface DecisionManifest {
  manifest_version: number;
  legal_states: string[];
  amendment_authority: string[];
  resolution_contract: { note: string; required_fields: string[]; outcome_vocabulary: string[] };
  decisions: DecisionRow[];
  standing_authorizations: { subject: string; state: string; note: string }[];
}

export interface GateCondition {
  id: string;
  text: string;
  rejects?: string[];
  requires_decision?: {
    decision_id: string;
    outcome: string;
    requires_content_ref: boolean;
    requires_content_version: boolean;
    evaluate_consequence: boolean;
  } | null;
}

export interface GateManifest {
  manifest_version: number;
  note: string;
  gates: {
    id: string;
    title: string;
    evaluates: string;
    excluded_conditions?: string[];
    conditions: GateCondition[];
    prohibition?: string;
    waivable: boolean;
  }[];
}

export interface TaskStateTransition {
  event: string;
  from: string;
  decision: 'ALLOWED' | 'REFUSED';
  target_rule?: string;
  note?: string;
  reason?: string;
}

export interface TaskStateManifest {
  manifest_version: number;
  authority: string;
  states: string[];
  terminal_states: string[];
  initial_state: string;
  obligations: { WAITING: string[]; BLOCKED: string[] };
  obligation_model: Record<string, string>;
  events: { name: string; covers: string }[];
  caller_contract: { submits: string[]; never_submits: string[]; rule: string };
  refusals_are_recorded: string;
  no_wildcards: string;
  success_preconditions: string[];
  abandonment_rules: string[];
  redo_rule: string;
  census: Record<string, number>;
  transitions: TaskStateTransition[];
}

export interface EvidenceModelManifest {
  manifest_version: number;
  authority: string;
  content_fields: { name: string; note: string }[];
  ordering: { authoritative: string; rule: string; forbidden_tiebreaks: string[] };
  conflict: Record<string, string>;
  provider_admission: string;
  snapshot: string;
  redemption_triple: string[];
}

export interface PolicyManifest {
  manifest_version: number;
  authority: string[];
  note: string;
  parameters: {
    key: string; type: string; value: number; maximum: number;
    waivable: boolean; authority: string; note: string;
  }[];
  infrastructure_retry: Record<string, string | number>;
}

export interface NonWaivableManifest {
  manifest_version: number;
  authority: string;
  rule: string;
  non_waivable: { id: string; subject: string; reference: string }[];
  waivable_targets: { requirement: string; default: string };
  amendment: string;
}

export interface Pr1OrderingManifest {
  manifest_version: number;
  authority: string[];
  pr1: { number: number; branch: string; frozen_head: string; required_state: string };
  reordering_permitted: boolean;
  coexistence: string;
  steps: { step: number; action: string; gate: string }[];
  prohibited_before_step_5: string[];
}

export interface SourceFile {
  path: string;
  content: string;
}

export interface SpecBundle {
  root: string;
  loadProblems: LoadProblem[];
  invariants: InvariantManifest;
  actionMatrix: ActionMatrix;
  slices: SliceManifest;
  triage: TriageManifest;
  findings: FindingManifest;
  decisions: DecisionManifest;
  gates: GateManifest;
  taskState: TaskStateManifest;
  evidenceModel: EvidenceModelManifest;
  policyParameters: PolicyManifest;
  nonWaivable: NonWaivableManifest;
  pr1Ordering: Pr1OrderingManifest;
  docs: Record<string, string>;
  /** Every file under src/, if the directory exists at all. */
  runtimeFiles: SourceFile[];
  configs: Record<string, string>;
}
