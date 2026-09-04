/**
 * Founder Gate.
 *
 * A gated action cannot proceed on anyone's assurance. Neither a worker nor the
 * Coordinator can unlock one by returning a string like "SAFE_TO_MERGE": the
 * only thing that opens a gate is a FounderDecision row in state RESOLVED,
 * belonging to that task and that category.
 *
 * Scoping matters. A resolved production-write decision for task A does not
 * authorise task B, and a resolved merge decision does not authorise a
 * production write. Both are enforced here rather than by convention.
 */

import type { FounderDecision, FounderDecisionCategory, Task } from '../domain/entities.js';
import type { Store } from '../state/store.js';
import type { Policy } from './schema.js';

export interface GateCheck {
  required: boolean;
  satisfied: boolean;
  category: FounderDecisionCategory;
  reason: string;
  decisionId: string | null;
}

/** Categories that always require a Founder decision when policy says so. */
export function gateRequired(policy: Policy, category: FounderDecisionCategory): boolean {
  switch (category) {
    case 'staging_write':
      return policy.remoteWrites.staging === 'founderRequired';
    case 'production_write':
      return policy.remoteWrites.production === 'founderRequired';
    case 'destructive_operation':
    case 'rollback':
      return policy.destructiveOperations.founderRequired;
    case 'merge':
      return policy.merge.default === 'founderRequired';
    case 'architecture_change':
    case 'product_semantics_change':
    case 'review_budget_extension':
      return true;
    default:
      return true;
  }
}

/**
 * Decide whether a category is authorised for a task.
 *
 * Deterministic and order-independent, because "whichever row was written last"
 * is not an authorisation model. A refusal anywhere in the set wins; a
 * cancellation authorises nothing; only an approval with no refusal opens the
 * gate. Anything ambiguous fails closed.
 */
function evaluateCategory(
  decisions: readonly FounderDecision[],
  taskId: string,
  category: FounderDecisionCategory,
): { authorised: boolean; reason: string; decisionId: string | null } {
  const relevant = decisions.filter((d) => d.taskId === taskId && d.category === category);
  const denied = relevant.find((d) => d.state === 'RESOLVED' && d.outcome === 'DENIED');
  if (denied) {
    return { authorised: false, reason: `decision ${denied.id} denied ${category}`, decisionId: denied.id };
  }
  const cancelled = relevant.find((d) => d.state === 'RESOLVED' && d.outcome === 'CANCELLED');
  const approved = relevant.find((d) => d.state === 'RESOLVED' && d.outcome === 'APPROVED');
  if (approved) {
    return { authorised: true, reason: `decision ${approved.id} approved ${category}`, decisionId: approved.id };
  }
  if (cancelled) {
    return {
      authorised: false,
      reason: `decision ${cancelled.id} was cancelled; cancellation is not approval`,
      decisionId: cancelled.id,
    };
  }
  const pending = relevant.find((d) => d.state === 'REQUIRED');
  return {
    authorised: false,
    reason: pending
      ? `founder decision ${pending.id} still REQUIRED`
      : `no approved founder decision for ${category}`,
    decisionId: pending?.id ?? null,
  };
}

/**
 * Is the gate for `category` open for `task`?
 *
 * A decision only counts when it matches this task AND this category AND is
 * RESOLVED. Decisions belonging to another task are invisible here.
 */
export function checkGate(
  store: Store,
  policy: Policy,
  task: Task,
  category: FounderDecisionCategory,
): GateCheck {
  const required = gateRequired(policy, category);
  if (!required) {
    return {
      required: false,
      satisfied: true,
      category,
      reason: `policy does not gate ${category}`,
      decisionId: null,
    };
  }
  const decisions = store.listFounderDecisions({ taskId: task.id });
  const verdict = evaluateCategory(decisions, task.id, category);
  return {
    required: true,
    satisfied: verdict.authorised,
    category,
    reason: verdict.reason,
    decisionId: verdict.decisionId,
  };
}

/**
 * Where a task should go once every decision on it has been answered.
 *
 * Derived from the whole set, not from whichever row was resolved last: a
 * refusal must not be overridden by a later approval of something else.
 */
export function continuationFor(
  decisions: readonly FounderDecision[],
): { target: 'BLOCKED_POLICY' | 'CANCELLED' | 'READY' | 'REVIEW_FIX' | 'READY_TO_MERGE'; reason: string } {
  const resolved = decisions.filter((d) => d.state === 'RESOLVED');
  const denied = resolved.find((d) => d.outcome === 'DENIED');
  if (denied) {
    return { target: 'BLOCKED_POLICY', reason: `decision ${denied.id} denied ${denied.category}` };
  }
  const cancelled = resolved.find((d) => d.outcome === 'CANCELLED');
  if (cancelled) {
    return { target: 'CANCELLED', reason: `decision ${cancelled.id} cancelled the work` };
  }
  const categories = new Set(resolved.map((d) => d.category));
  if (categories.has('review_budget_extension')) {
    return { target: 'REVIEW_FIX', reason: 'review budget extended' };
  }
  if (categories.size === 1 && categories.has('merge')) {
    return { target: 'READY_TO_MERGE', reason: 'merge approved' };
  }
  return { target: 'READY', reason: 'all decisions approved' };
}

/** Create the decision row if this task does not already have an open one. */
export function requireDecision(
  store: Store,
  task: Task,
  category: FounderDecisionCategory,
  question: string,
  provenance: string,
): FounderDecision {
  const existing = store
    .listFounderDecisions({ taskId: task.id })
    .find((d) => d.category === category && d.state === 'REQUIRED');
  if (existing) return existing;
  return store.createFounderDecision({
    taskId: task.id,
    category,
    question,
    provenance,
  });
}
