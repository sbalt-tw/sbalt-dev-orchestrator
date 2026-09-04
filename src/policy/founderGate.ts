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

function findResolved(
  decisions: readonly FounderDecision[],
  taskId: string,
  category: FounderDecisionCategory,
): FounderDecision | null {
  return (
    decisions.find(
      (d) => d.taskId === taskId && d.category === category && d.state === 'RESOLVED',
    ) ?? null
  );
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
  const resolved = findResolved(decisions, task.id, category);
  if (resolved) {
    return {
      required: true,
      satisfied: true,
      category,
      reason: `founder decision ${resolved.id} resolved`,
      decisionId: resolved.id,
    };
  }
  const pending = decisions.find((d) => d.category === category && d.state === 'REQUIRED');
  return {
    required: true,
    satisfied: false,
    category,
    reason: pending
      ? `founder decision ${pending.id} still REQUIRED`
      : `no founder decision recorded for ${category}`,
    decisionId: pending?.id ?? null,
  };
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
