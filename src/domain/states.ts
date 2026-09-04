/**
 * Finite task state machine.
 *
 * Every state and event is enumerated here. There is no free-form state string
 * anywhere in the system: `TaskState` and `TaskEvent` are the only vocabulary,
 * and `ALLOWED_TRANSITIONS` is the only place a transition may be introduced.
 *
 * See docs/state-machine.md for the narrative description and the rationale
 * behind the two refinement events that are not in the original event list.
 */

export const TASK_STATES = [
  'QUEUED',
  'READY',
  'RUNNING',
  'WAITING_DEPENDENCY',
  'WAITING_CI',
  'WAITING_REVIEW',
  'REVIEW_FIX',
  'FOUNDER_DECISION',
  'BLOCKED_INFRA',
  'BLOCKED_POLICY',
  'READY_TO_MERGE',
  'DONE',
  'CANCELLED',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

/** States from which no transition is possible. */
export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set<TaskState>(['DONE', 'CANCELLED']);

export const TASK_EVENTS = [
  'TASK_CREATED',
  'DEPENDENCIES_SATISFIED',
  // Refinement: the original list had no event for "a dependency is not yet
  // met". Without it, entering WAITING_DEPENDENCY would require an implicit
  // transition, which this engine forbids.
  'DEPENDENCIES_UNSATISFIED',
  'WORKER_ASSIGNED',
  'WORKER_COMPLETED',
  'WORKER_FAILED',
  'PR_OPENED',
  'CI_STARTED',
  'CI_PASSED',
  'CI_FAILED',
  'CODEX_STARTED',
  'CODEX_VERDICT',
  'REVIEW_FIX_REQUIRED',
  'FOUNDER_DECISION_REQUIRED',
  'FOUNDER_DECISION_RESOLVED',
  'RESOURCE_UNAVAILABLE',
  'RESOURCE_ACQUIRED',
  'RESOURCE_RELEASED',
  'MERGE_READY',
  'MERGED',
  'INFRA_FAILURE',
  'RECOVERED',
  // Refinement: cancellation is an operator action, distinct from any of the
  // workflow signals above.
  'TASK_CANCELLED',
] as const;

export type TaskEvent = (typeof TASK_EVENTS)[number];

/**
 * (state, event) -> the set of states the engine may move to.
 *
 * Most pairs have exactly one target. A few are genuinely multi-target because
 * the destination depends on data the engine evaluates deterministically:
 * CODEX_VERDICT depends on finding counts and the remaining review budget, and
 * FOUNDER_DECISION_RESOLVED depends on what the Founder actually decided. In
 * those cases the caller proposes a target and the engine validates that the
 * proposal is a member of this set, so the transition is still explicitly
 * allowed rather than free-form.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<TaskState, Partial<Record<TaskEvent, readonly TaskState[]>>>
> = {
  QUEUED: {
    DEPENDENCIES_SATISFIED: ['READY'],
    DEPENDENCIES_UNSATISFIED: ['WAITING_DEPENDENCY'],
    FOUNDER_DECISION_REQUIRED: ['FOUNDER_DECISION'],
    INFRA_FAILURE: ['BLOCKED_INFRA'],
    TASK_CANCELLED: ['CANCELLED'],
  },
  WAITING_DEPENDENCY: {
    DEPENDENCIES_SATISFIED: ['READY'],
    DEPENDENCIES_UNSATISFIED: ['WAITING_DEPENDENCY'],
    INFRA_FAILURE: ['BLOCKED_INFRA'],
    TASK_CANCELLED: ['CANCELLED'],
  },
  READY: {
    WORKER_ASSIGNED: ['RUNNING'],
    // Losing a race for a scarce resource is normal and keeps the task READY.
    RESOURCE_UNAVAILABLE: ['READY'],
    RESOURCE_ACQUIRED: ['READY'],
    DEPENDENCIES_UNSATISFIED: ['WAITING_DEPENDENCY'],
    FOUNDER_DECISION_REQUIRED: ['FOUNDER_DECISION'],
    INFRA_FAILURE: ['BLOCKED_INFRA'],
    TASK_CANCELLED: ['CANCELLED'],
  },
  RUNNING: {
    PR_OPENED: ['WAITING_CI'],
    // Only legal for tasks that do not require a PR; the engine guards this.
    WORKER_COMPLETED: ['DONE'],
    WORKER_FAILED: ['BLOCKED_INFRA', 'REVIEW_FIX'],
    FOUNDER_DECISION_REQUIRED: ['FOUNDER_DECISION'],
    RESOURCE_RELEASED: ['RUNNING'],
    INFRA_FAILURE: ['BLOCKED_INFRA'],
    TASK_CANCELLED: ['CANCELLED'],
  },
  WAITING_CI: {
    CI_STARTED: ['WAITING_CI'],
    CI_PASSED: ['WAITING_REVIEW'],
    CI_FAILED: ['REVIEW_FIX'],
    PR_OPENED: ['WAITING_CI'],
    FOUNDER_DECISION_REQUIRED: ['FOUNDER_DECISION'],
    INFRA_FAILURE: ['BLOCKED_INFRA'],
    TASK_CANCELLED: ['CANCELLED'],
  },
  WAITING_REVIEW: {
    CODEX_STARTED: ['WAITING_REVIEW'],
    // Target depends on findings and remaining budget.
    CODEX_VERDICT: ['READY_TO_MERGE', 'REVIEW_FIX', 'FOUNDER_DECISION'],
    REVIEW_FIX_REQUIRED: ['REVIEW_FIX'],
    RESOURCE_UNAVAILABLE: ['WAITING_REVIEW'],
    RESOURCE_ACQUIRED: ['WAITING_REVIEW'],
    RESOURCE_RELEASED: ['WAITING_REVIEW'],
    FOUNDER_DECISION_REQUIRED: ['FOUNDER_DECISION'],
    // An infrastructure abort never consumes a completed verdict round.
    INFRA_FAILURE: ['BLOCKED_INFRA'],
    TASK_CANCELLED: ['CANCELLED'],
  },
  REVIEW_FIX: {
    WORKER_ASSIGNED: ['RUNNING'],
    RESOURCE_UNAVAILABLE: ['REVIEW_FIX'],
    FOUNDER_DECISION_REQUIRED: ['FOUNDER_DECISION'],
    INFRA_FAILURE: ['BLOCKED_INFRA'],
    TASK_CANCELLED: ['CANCELLED'],
  },
  FOUNDER_DECISION: {
    FOUNDER_DECISION_RESOLVED: [
      'QUEUED',
      'READY',
      'REVIEW_FIX',
      'READY_TO_MERGE',
      'BLOCKED_POLICY',
      'CANCELLED',
    ],
    INFRA_FAILURE: ['BLOCKED_INFRA'],
    TASK_CANCELLED: ['CANCELLED'],
  },
  BLOCKED_INFRA: {
    // Every state INFRA_FAILURE can be entered from must appear here, or a
    // task interrupted in that state would be permanently unrecoverable.
    // FOUNDER_DECISION is included because a task interrupted while waiting
    // for a human must come back still waiting for that human. Recovery
    // restores where the work was; it never clears an authorisation.
    RECOVERED: ['QUEUED', 'READY', 'REVIEW_FIX', 'WAITING_REVIEW', 'WAITING_CI', 'FOUNDER_DECISION'],
    FOUNDER_DECISION_REQUIRED: ['FOUNDER_DECISION'],
    TASK_CANCELLED: ['CANCELLED'],
  },
  BLOCKED_POLICY: {
    FOUNDER_DECISION_REQUIRED: ['FOUNDER_DECISION'],
    FOUNDER_DECISION_RESOLVED: ['QUEUED', 'READY', 'CANCELLED'],
    TASK_CANCELLED: ['CANCELLED'],
  },
  READY_TO_MERGE: {
    MERGE_READY: ['READY_TO_MERGE'],
    FOUNDER_DECISION_REQUIRED: ['FOUNDER_DECISION'],
    // Guarded: requires a resolved merge decision and a clean review at the
    // exact current head.
    MERGED: ['DONE'],
    // A new head or a late finding sends the task back for rework.
    REVIEW_FIX_REQUIRED: ['REVIEW_FIX'],
    INFRA_FAILURE: ['BLOCKED_INFRA'],
    TASK_CANCELLED: ['CANCELLED'],
  },
  DONE: {},
  CANCELLED: {},
};

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.has(state);
}

export function allowedTargets(state: TaskState, event: TaskEvent): readonly TaskState[] {
  return ALLOWED_TRANSITIONS[state][event] ?? [];
}
