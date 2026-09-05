// Shapes of the specification manifests. This module is part of the specification
// toolchain: it is not runtime code and nothing under src/ may import it.

export type Disposition = 'REQUIRED' | 'FIXED' | 'OPTIONAL' | 'FORBIDDEN';

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
  owners: {
    normative: string;
    enforcement: string[];
    persistence: string;
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
  rationale: string;
  target_slice: string | null;
  replacement: string | null;
  audit_note: string;
}

export interface TriageManifest {
  manifest_version: number;
  source_head: string;
  source_note: string;
  census: { rows: number; KEEP: number; REWRITE: number; DROP: number };
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
}

export interface DecisionManifest {
  manifest_version: number;
  legal_states: string[];
  amendment_authority: string[];
  decisions: {
    id: string;
    decision: string;
    state: string;
    amended_by: string[];
    blocks: string[];
    note?: string;
  }[];
  standing_authorizations: { subject: string; state: string; note: string }[];
}

export interface GateManifest {
  manifest_version: number;
  note: string;
  gates: {
    id: string;
    title: string;
    evaluates: string;
    excluded_conditions?: string[];
    conditions: { id: string; text: string }[];
    prohibition?: string;
  }[];
}

export interface SourceFile {
  path: string;
  content: string;
}

export interface SpecBundle {
  root: string;
  invariants: InvariantManifest;
  actionMatrix: ActionMatrix;
  slices: SliceManifest;
  triage: TriageManifest;
  findings: FindingManifest;
  decisions: DecisionManifest;
  gates: GateManifest;
  docs: Record<string, string>;
  /** Every tracked file under src/, if the directory exists at all. */
  runtimeFiles: SourceFile[];
  /** tsconfig.build.json, package.json and the negative-test file, as raw text. */
  configs: Record<string, string>;
}
