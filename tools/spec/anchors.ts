// Canonical anchors.
//
// These are the expected values the validator checks the manifests against. They live in
// code, deliberately separate from the data they validate, and are never derived from it:
// a manifest that edits its own declaration of what is legal changes nothing here.
//
// Round 1 of the PR-0 review found six places where a check read its expectation out of the
// same file it was checking. Every one of those is now anchored below.
//
// Changing any value here is a specification change and requires a Founder decision
// reference in the `authority` field of the constant it touches.

export const ANCHOR_AUTHORITY = {
  invariants: 'D1, amended by FE-1..FE-8',
  actionMatrix: 'D7, amended by FE-2; extended by D16',
  slices: 'D4',
  taskState: 'D15',
  evidence: 'D17',
  policy: 'D16, D18',
  nonWaivable: 'D18',
  decisions: 'D1-D19',
  gates: 'FE-8, D18, D19',
  triage: 'D10, D19',
  findings: 'D19',
  pr1Ordering: 'D11',
  census: 'D19',
} as const;

// ---------------------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------------------

export const FAMILY_NAMES: Record<string, string> = {
  A: 'authorization',
  E: 'evidence',
  S: 'state',
  L: 'authority-and-leases',
  X: 'external-effects',
  R: 'resources-and-gates',
  P: 'reviewer-capacity',
  M: 'migrations',
};

export const INVARIANT_IDS: readonly string[] = [
  'INV-A1', 'INV-A2', 'INV-A3', 'INV-A4', 'INV-A5', 'INV-A6', 'INV-A7', 'INV-A8', 'INV-A9',
  'INV-E1', 'INV-E2', 'INV-E3', 'INV-E4', 'INV-E5', 'INV-E6', 'INV-E7', 'INV-E8',
  'INV-S1', 'INV-S2', 'INV-S3', 'INV-S4', 'INV-S5', 'INV-S6',
  'INV-L1', 'INV-L2', 'INV-L3', 'INV-L4', 'INV-L5', 'INV-L6', 'INV-L7', 'INV-L8',
  'INV-X1', 'INV-X2', 'INV-X3', 'INV-X4',
  'INV-R1', 'INV-R2', 'INV-R3', 'INV-R4',
  'INV-P1', 'INV-P2', 'INV-P3',
  'INV-M1', 'INV-M2', 'INV-M3', 'INV-M4', 'INV-M5',
];

export const FAMILY_MEMBERSHIP: Record<string, readonly string[]> = {
  A: ['INV-A1', 'INV-A2', 'INV-A3', 'INV-A4', 'INV-A5', 'INV-A6', 'INV-A7', 'INV-A8', 'INV-A9'],
  E: ['INV-E1', 'INV-E2', 'INV-E3', 'INV-E4', 'INV-E5', 'INV-E6', 'INV-E7', 'INV-E8'],
  S: ['INV-S1', 'INV-S2', 'INV-S3', 'INV-S4', 'INV-S5', 'INV-S6'],
  L: ['INV-L1', 'INV-L2', 'INV-L3', 'INV-L4', 'INV-L5', 'INV-L6', 'INV-L7', 'INV-L8'],
  X: ['INV-X1', 'INV-X2', 'INV-X3', 'INV-X4'],
  R: ['INV-R1', 'INV-R2', 'INV-R3', 'INV-R4'],
  P: ['INV-P1', 'INV-P2', 'INV-P3'],
  M: ['INV-M1', 'INV-M2', 'INV-M3', 'INV-M4', 'INV-M5'],
};

/** FE-9 is a documentation-status erratum and maps to no invariant. That is deliberate. */
export const ERRATA_MAP: Record<string, readonly string[]> = {
  'FE-1': ['INV-A2', 'INV-A3', 'INV-A6', 'INV-L3', 'INV-X4'],
  'FE-2': ['INV-A3', 'INV-A4', 'INV-A5', 'INV-A9'],
  'FE-3': ['INV-A4', 'INV-A6', 'INV-E1', 'INV-E2', 'INV-E3', 'INV-E4', 'INV-E7'],
  'FE-4': ['INV-L5', 'INV-L7', 'INV-X1', 'INV-X3'],
  'FE-5': ['INV-A1', 'INV-S5', 'INV-X3'],
  'FE-6': ['INV-L5', 'INV-L7', 'INV-P1', 'INV-P2', 'INV-X2'],
  'FE-7': ['INV-L7', 'INV-X2'],
  'FE-8': ['INV-A1', 'INV-R1'],
};

export const ERRATA_WITHOUT_INVARIANTS: readonly string[] = ['FE-9'];

export const DECISION_INVARIANT_MAP: Record<string, readonly string[]> = {
  D15: ['INV-S1', 'INV-S2', 'INV-S3', 'INV-S4', 'INV-S5', 'INV-S6'],
  D16: ['INV-A3', 'INV-A5', 'INV-X2'],
  D17: ['INV-E1', 'INV-E2'],
  D18: ['INV-A9', 'INV-E8', 'INV-R1'],
  D19: ['INV-M3'],
};

/** Persistence may be n/a only here, and only with a written reason. */
export const PERSISTENCE_NA_ALLOWED: readonly string[] = ['INV-A1', 'INV-M2'];

// ---------------------------------------------------------------------------------------
// Action matrix
// ---------------------------------------------------------------------------------------

export const ENVELOPE_FIELDS: readonly string[] = [
  'schema_version', 'authorization_id', 'action_kind', 'project_id', 'lane_id', 'task_id',
  'wait_id', 'decision_id', 'target_identity', 'repository_identity', 'pr_number', 'base_sha',
  'head_sha', 'artifact_digest', 'effect_parameters_digest', 'policy_revision',
  'evidence_snapshot_ref', 'outcome', 'issuer', 'recipient', 'issued_at', 'expires_at',
  'use_limit', 'justification', 'envelope_digest',
];

export const ALWAYS_REQUIRED_FIELDS: readonly string[] = [
  'schema_version', 'authorization_id', 'action_kind', 'project_id', 'lane_id', 'task_id',
  'wait_id', 'decision_id', 'target_identity', 'effect_parameters_digest', 'policy_revision',
  'outcome', 'issuer', 'recipient', 'issued_at', 'expires_at', 'envelope_digest',
];

export const DISPOSITIONS: readonly string[] = ['REQUIRED', 'FIXED', 'OPTIONAL', 'FORBIDDEN'];

/**
 * The seven kinds, described by what each adds to the seventeen always-required fields.
 * Written in a different shape from the manifest on purpose: a blind copy of the manifest
 * would resynchronise with a mistake instead of catching it.
 */
export interface KindAnchor {
  target_scheme: string;
  extra_required: readonly string[];
  fixed: Readonly<Record<string, number>>;
  optional: readonly string[];
  forbidden: readonly string[];
}

export const ACTION_KINDS: Record<string, KindAnchor> = {
  merge: {
    target_scheme: 'git:',
    extra_required: ['repository_identity', 'pr_number', 'base_sha', 'head_sha', 'evidence_snapshot_ref'],
    fixed: { use_limit: 1 },
    optional: ['justification'],
    forbidden: ['artifact_digest'],
  },
  staging_write: {
    target_scheme: 'env:',
    extra_required: ['artifact_digest', 'evidence_snapshot_ref', 'use_limit'],
    fixed: {},
    optional: ['repository_identity', 'pr_number', 'base_sha', 'head_sha', 'justification'],
    forbidden: [],
  },
  production_write: {
    target_scheme: 'env:',
    extra_required: ['artifact_digest', 'evidence_snapshot_ref', 'justification'],
    fixed: { use_limit: 1 },
    optional: ['repository_identity', 'pr_number', 'base_sha', 'head_sha'],
    forbidden: [],
  },
  destructive_operation: {
    target_scheme: 'resource:',
    extra_required: ['justification'],
    fixed: { use_limit: 1 },
    optional: ['repository_identity', 'evidence_snapshot_ref'],
    forbidden: ['pr_number', 'base_sha', 'head_sha', 'artifact_digest'],
  },
  policy_weakening: {
    target_scheme: 'policy:',
    extra_required: ['justification'],
    fixed: { use_limit: 1 },
    optional: [],
    forbidden: ['repository_identity', 'pr_number', 'base_sha', 'head_sha', 'artifact_digest', 'evidence_snapshot_ref'],
  },
  waive_finding: {
    target_scheme: 'finding:',
    extra_required: ['repository_identity', 'pr_number', 'base_sha', 'head_sha', 'justification'],
    fixed: { use_limit: 1 },
    optional: [],
    forbidden: ['artifact_digest', 'evidence_snapshot_ref'],
  },
  worker_dispatch: {
    target_scheme: 'worker:',
    extra_required: ['use_limit'],
    fixed: {},
    optional: ['repository_identity', 'pr_number', 'base_sha', 'head_sha', 'artifact_digest', 'justification'],
    forbidden: ['evidence_snapshot_ref'],
  },
};

export const GIT_PROVENANCE_GROUP = {
  members: ['repository_identity', 'pr_number', 'base_sha', 'head_sha'] as readonly string[],
  applies_to: ['staging_write', 'production_write', 'worker_dispatch'] as readonly string[],
  core: ['repository_identity', 'base_sha', 'head_sha'] as readonly string[],
};

export const IDENTITY_SCHEMES: readonly string[] = [
  'git:', 'env:', 'resource:', 'policy:', 'finding:', 'worker:',
];

export const MATRIX_CENSUS = { fields: 25, action_kinds: 7, cells: 175, always_required_fields: 17 };

// ---------------------------------------------------------------------------------------
// Slices and migrations
// ---------------------------------------------------------------------------------------

export const SLICE_ORDER: readonly string[] = [
  'PR-0', 'PR-A', 'PR-B', 'PR-C', 'PR-D', 'PR-E', 'PR-F', 'PR-G', 'PR-H', 'PR-I',
];

export const MIGRATION_CHAIN: readonly string[] = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'];

export const SLICE_MIGRATION: Record<string, string | null> = {
  'PR-0': null, 'PR-A': 'v1', 'PR-B': null, 'PR-C': 'v2', 'PR-D': 'v3',
  'PR-E': 'v4', 'PR-F': 'v5', 'PR-G': 'v6', 'PR-H': 'v7', 'PR-I': null,
};

// ---------------------------------------------------------------------------------------
// Task state model (D15)
// ---------------------------------------------------------------------------------------

export const TASK_STATES: readonly string[] = [
  'PENDING', 'READY', 'DISPATCHING', 'RUNNING', 'WAITING', 'BLOCKED',
  'SUCCEEDED', 'FAILED', 'CANCELLED',
];

export const TERMINAL_STATES: readonly string[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];

export const INITIAL_STATE = 'PENDING';

export const WAITING_OBLIGATIONS: readonly string[] = [
  'EVIDENCE', 'FOUNDER_DECISION', 'EFFECT_RECONCILIATION',
];

export const BLOCKED_OBLIGATIONS: readonly string[] = [
  'INFRASTRUCTURE', 'POLICY', 'AUTHORITY_LOST', 'DEPENDENCY_FAILED',
];

export const TASK_EVENTS: readonly string[] = [
  'TASK_CREATED', 'DEPENDENCIES_SATISFIED', 'DISPATCH_INTENT_RECORDED', 'DISPATCH_CONFIRMED',
  'DISPATCH_AMBIGUOUS', 'WORKER_REPORT_ACCEPTED', 'OBLIGATION_OPENED', 'OBLIGATION_RESOLVED',
  'BLOCKER_OPENED', 'BLOCKER_RESOLVED', 'DEFINITIVE_SUCCESS', 'DEFINITIVE_FAILURE',
  'CANCELLATION_AUTHENTICATED',
];

/** The eleven categories D15 requires the event vocabulary to cover. */
export const REQUIRED_EVENT_COVERAGE: readonly string[] = [
  'task creation', 'dependency satisfaction', 'dispatch intent', 'dispatch success',
  'dispatch ambiguity', 'worker report', 'obligation open', 'obligation resolve',
  'blocker open', 'blocker resolve', 'definitive success', 'definitive failure',
  'authenticated cancellation',
];

export const TASK_STATE_CENSUS = { states: 9, terminal_states: 3, events: 13, pairs: 117 };

export const SUCCESS_PRECONDITION_COUNT = 6;
export const ABANDONMENT_RULE_COUNT = 3;

// ---------------------------------------------------------------------------------------
// Evidence model (D17)
// ---------------------------------------------------------------------------------------

export const EVIDENCE_CONTENT_FIELDS: readonly string[] = [
  'evidence_slot_identity', 'evidence_kind', 'provider_immutable_identity', 'project_identity',
  'task_identity', 'tuple', 'logical_check_key', 'provider_source_event_identity',
  'source_generation', 'status', 'conclusion', 'source_principal', 'observed_at',
];

export const EVIDENCE_ORDERING_FIELD = 'source_generation';

export const EVIDENCE_FORBIDDEN_TIEBREAKS: readonly string[] = [
  'observed_at', 'database ingestion order', 'row id', 'insertion sequence',
];

// ---------------------------------------------------------------------------------------
// Policy parameters (D16, D18)
// ---------------------------------------------------------------------------------------

export const POLICY_PARAMETERS: Record<string, { value: number; maximum: number; waivable: boolean }> = {
  'worker_dispatch.max_use_limit': { value: 16, maximum: 16, waivable: false },
  'infrastructure.max_attempts_per_operation': { value: 2, maximum: 2, waivable: false },
  'review.completed_verdict_rounds.default': { value: 2, maximum: 3, waivable: false },
};

export const INFRASTRUCTURE_ATTEMPTS = 2;

// ---------------------------------------------------------------------------------------
// Non-waivable set (D18)
// ---------------------------------------------------------------------------------------

export const NON_WAIVABLE_IDS: readonly string[] = [
  'NW-1', 'NW-2', 'NW-3', 'NW-4', 'NW-5', 'NW-6', 'NW-7', 'NW-8', 'NW-9', 'NW-10',
];

export const NON_WAIVABLE_SUBJECT_KEYWORDS: readonly string[] = [
  'INV-A1', 'Phase 0 completion gate', 'Phase 1A entry gate', 'staging-write',
  'production-write', 'destructive-operation', 'Codex independence', 'capacity = 1',
  'exact-head review', 'One implementation PR per lane',
];

// ---------------------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------------------

export const DECISION_STATES: Record<string, string> = {
  D1: 'APPROVED_AS_AMENDED', D2: 'APPROVED_AS_AMENDED', D3: 'APPROVED_AS_AMENDED',
  D4: 'APPROVED_AS_AMENDED', D5: 'APPROVED_AS_AMENDED', D6: 'APPROVED_AS_AMENDED',
  D7: 'APPROVED_AS_AMENDED', D8: 'APPROVED_AS_AMENDED', D9: 'APPROVED_AS_AMENDED',
  D10: 'APPROVED_AS_AMENDED', D11: 'APPROVED', D12: 'DEFERRED', D13: 'DEFERRED',
  D14: 'DEFERRED', D15: 'APPROVED', D16: 'APPROVED', D17: 'APPROVED', D18: 'APPROVED',
  D19: 'APPROVED',
};

export const LEGAL_DECISION_STATES: readonly string[] = [
  'APPROVED', 'APPROVED_AS_AMENDED', 'DEFERRED', 'NOT_AUTHORIZED',
];

export const AMENDED_DECISIONS: readonly string[] = [
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10',
];

export const STANDING_NOT_AUTHORIZED: readonly string[] = [
  'PR #1 closure', 'PR-0 merge', 'Phase 1A implementation',
];

// ---------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------

export const PHASE0_CONDITIONS: readonly string[] = [
  'G0-1', 'G0-2', 'G0-3', 'G0-4', 'G0-5', 'G0-6', 'G0-7', 'G0-8', 'G0-9', 'G0-10', 'G0-11',
];

export const PHASE1A_CONDITIONS: readonly string[] = ['G1-1', 'G1-2', 'G1-3', 'G1-4', 'G1-5'];

export const G0_8_REJECTS: readonly string[] = [
  'UNKNOWN_PENDING_RECONCILIATION', 'ABANDONED_BY_DECISION', 'effect_truth=UNKNOWN', 'quarantined',
];

/** Which Phase 1A conditions must consume a decision, and how. */
export const PHASE1A_DECISION_REQUIREMENTS: Record<string, string> = {
  'G1-2': 'D13',
  'G1-3': 'D14',
  'G1-4': 'D14',
};

export const GATES_NON_WAIVABLE: readonly string[] = ['phase0_completion', 'phase1a_entry'];

// ---------------------------------------------------------------------------------------
// Test triage
// ---------------------------------------------------------------------------------------

export const FROZEN_PR1_HEAD = '428ae75e91fa1dd23c371d5f7af745aba0bec7fd';

export const TRIAGE_CENSUS = { rows: 141, KEEP: 106, REWRITE: 30, DROP: 5 };

export const TRIAGE_MAPPING_BASES: readonly string[] = ['invariant', 'slice_local'];

/** Rows no invariant statement covers. Each names the slice that owns it and its test. */
export const TRIAGE_SLICE_LOCAL_ROWS: readonly number[] = [14, 15, 16, 17, 23, 24, 25, 65, 140, 141];

export const TRIAGE_SOURCE_FILES: Record<string, number> = {
  'tests/contracts.test.ts': 13,
  'tests/demo.test.ts': 7,
  'tests/dependencies.test.ts': 6,
  'tests/founderGate.test.ts': 6,
  'tests/hardening.test.ts': 28,
  'tests/lanePolicy.test.ts': 5,
  'tests/recovery.test.ts': 5,
  'tests/resources.test.ts': 5,
  'tests/review.test.ts': 8,
  'tests/round4.test.ts': 18,
  'tests/stateMachine.test.ts': 9,
  'tests/upgrade.test.ts': 25,
  'tests/workers.test.ts': 6,
};

// ---------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------

export const PR1_ROUNDS: readonly number[] = [1, 2, 3, 4, 5];

export const PR1_FINDING_IDS: readonly string[] = [
  'R1-F1', 'R1-F2', 'R1-F3', 'R1-F4', 'R1-F5', 'R1-F6', 'R1-F7', 'R1-F8', 'R1-F9',
  'R2-F1', 'R2-F2', 'R2-F3', 'R2-F4', 'R2-F5', 'R2-F6', 'R2-F7', 'R2-F8', 'R2-F9', 'R2-F10',
  'R3-F1', 'R3-F2', 'R3-F3', 'R3-F4', 'R3-F5', 'R3-F6',
  'R4-F1', 'R4-F2', 'R4-F3', 'R4-F4', 'R4-F5', 'R4-F6', 'R4-F7', 'R4-F8', 'R4-F9',
  'R5-F1', 'R5-F2', 'R5-F3', 'R5-F4', 'R5-F5', 'R5-F6', 'R5-F7', 'R5-F8',
];

export const DEBT_IDS: readonly string[] = ['DEBT-1', 'DEBT-2', 'DEBT-3'];

export const PR0_ROUND1_FINDING_IDS: readonly string[] = [
  'PR0-R1-01', 'PR0-R1-02', 'PR0-R1-03', 'PR0-R1-04', 'PR0-R1-05', 'PR0-R1-06',
  'PR0-R1-07', 'PR0-R1-08', 'PR0-R1-09', 'PR0-R1-10', 'PR0-R1-11', 'PR0-R1-12',
  'PR0-R1-13', 'PR0-R1-14', 'PR0-R1-15', 'PR0-R1-16', 'PR0-R1-17', 'PR0-R1-18',
  'PR0-R1-19', 'PR0-R1-20', 'PR0-R1-21', 'PR0-R1-22',
];

export const PR0_ROUND1_VERDICT = { blocker: 6, high: 8, medium: 6, low: 2 };

export const PR0_REVIEWED_BASE = '855ff2b3b139ad8f17fd04118fa5ec090616a24b';
export const PR0_ROUND1_HEAD = '88b7a77f544d70a01697342ed8bcd74fdcaa395e';

// ---------------------------------------------------------------------------------------
// PR #1 ordering
// ---------------------------------------------------------------------------------------

export const PR1_ORDERING_STEPS: readonly string[] = [
  'Plan v2.2 delivered',
  'Founder approves D1-D10 and authorises D11',
  'PR-0 opens',
  'PR-0 reviewed at its exact head, findings resolved, merged',
  'Founder separately authorises closing PR #1',
  'PR #1 closed unmerged with a superseded note; branch and full review history retained',
  'Only then may PR-A open',
];

// ---------------------------------------------------------------------------------------
// Documents and manifests that must exist, load and be non-empty
// ---------------------------------------------------------------------------------------

export const REQUIRED_DOCS: readonly string[] = [
  'README.md', '00-model.md', '01-invariants.md', '02-envelope.md', '03-evidence.md',
  '04-journal.md', '05-leases.md', '06-review.md', '07-identity.md', '08-slices.md',
  '09-decisions.md', '10-gates.md', '11-pr1-disposition.md', '12-errata.md',
  '13-test-triage.md', '14-findings.md', '15-task-state.md', '16-non-waivable.md',
];

export const REQUIRED_MANIFESTS: readonly string[] = [
  'invariants.json', 'action-matrix.json', 'slices.json', 'test-triage.json',
  'findings.json', 'decisions.json', 'gates.json', 'task-state.json',
  'evidence-model.json', 'policy-parameters.json', 'non-waivable.json', 'pr1-ordering.json',
];

// ---------------------------------------------------------------------------------------
// The runtime boundary
// ---------------------------------------------------------------------------------------

/** Specifier fragments runtime code may never resolve to. */
export const FORBIDDEN_RUNTIME_TARGETS: readonly string[] = ['tools/spec', 'spec/manifests', 'spec/'];

/** Runtime modules permitted to load a specifier the checker cannot resolve statically. */
export const DYNAMIC_IMPORT_ALLOWLIST: readonly string[] = [];

// ---------------------------------------------------------------------------------------
// Census of the validator itself
// ---------------------------------------------------------------------------------------

/**
 * The reviewed head 88b7a77f carried 44 fixtures over 40 failure codes. The commit message
 * said 41 codes and the Round-1 report said 45 fixtures over 41 codes; both were wrong, and
 * this constant records the corrected historical fact (D19 item 18).
 */
export const CENSUS_AT_ROUND1_HEAD = { fixtures: 44, failure_codes: 40 };

/**
 * Two failure codes are produced by the fixture runner itself and cannot be provoked by
 * mutating a bundle. They are covered by direct unit tests instead, and the exemption is
 * recorded here rather than left implicit.
 */
export const FIXTURE_EXEMPT_CODES: readonly string[] = [
  'NEGATIVE_FIXTURE_MISSING',
  'NEGATIVE_FIXTURE_INERT',
];

/** The current census of the validator. Both numbers are asserted, never inferred. */
export const CENSUS_CURRENT = { fixtures: 83, failure_codes: 81 };
