/**
 * Review model.
 *
 * Codex review is represented structurally — counts and SHAs — never as prose.
 * The orchestrator decides from numbers, so a reviewer that writes a reassuring
 * paragraph while reporting a HIGH finding still sends the task back for a fix.
 *
 * Two rules carry real weight:
 *
 *  1. A review killed by infrastructure produced no verdict, so it does not
 *     consume a completed verdict round. Budget exhaustion must mean "three
 *     reviewers actually looked and still found something", not "the machine
 *     ran out of disk three times".
 *
 *  2. Merge readiness is anchored to an exact head. A clean verdict on an older
 *     commit says nothing about the commit that would actually be merged.
 */

import type { ReviewAttempt, RiskClass, Task } from '../domain/entities.js';
import type { Policy } from './schema.js';

export interface ReviewBudget {
  maxRounds: number;
  completedVerdictRounds: number;
  remainingRounds: number;
  exhausted: boolean;
}

export function maxRoundsFor(policy: Policy, riskClass: RiskClass, override: number | null): number {
  if (override !== null) return override;
  return riskClass === 'HIGH' ? policy.review.highRiskMaxRounds : policy.review.standardMaxRounds;
}

/**
 * Only attempts that produced a verdict count.
 *
 * This is not configurable. "Budget exhausted" has to mean reviewers actually
 * looked and still found something; if a machine ran out of disk three times
 * the task has had zero real reviews, and escalating that to a human asks a
 * question nobody can answer. The aborted attempts are still recorded, so the
 * flakiness stays visible.
 */
export function completedVerdictRounds(attempts: readonly ReviewAttempt[], _policy: Policy): number {
  return attempts.filter((a) => a.status === 'COMPLETED_VERDICT').length;
}

export function reviewBudget(
  task: Task,
  attempts: readonly ReviewAttempt[],
  policy: Policy,
): ReviewBudget {
  const maxRounds = maxRoundsFor(policy, task.riskClass, task.reviewMaxRounds);
  const used = completedVerdictRounds(attempts, policy);
  const remaining = Math.max(0, maxRounds - used);
  return {
    maxRounds,
    completedVerdictRounds: used,
    remainingRounds: remaining,
    exhausted: remaining <= 0,
  };
}

/** The round number the next review attempt should carry. */
export function nextRoundNumber(attempts: readonly ReviewAttempt[], policy: Policy): number {
  return completedVerdictRounds(attempts, policy) + 1;
}

export function isCleanVerdict(
  attempt: Pick<ReviewAttempt, 'blocker' | 'high' | 'status'>,
  policy: Policy,
): boolean {
  return (
    attempt.status === 'COMPLETED_VERDICT' &&
    attempt.blocker <= policy.review.stopWhen.blocker &&
    attempt.high <= policy.review.stopWhen.high
  );
}

/**
 * A task is review-clean for merge only when some completed verdict at the
 * task's *current* head found no blocker and no high.
 */
export function cleanAtCurrentHead(
  task: Task,
  attempts: readonly ReviewAttempt[],
  policy: Policy,
): boolean {
  if (!task.prHeadSha) return false;
  // The *latest* verdict at this head, not any of them. Asking whether some
  // clean verdict exists meant a later reviewer finding a blocker at the same
  // commit could not take back the earlier all-clear.
  const atHead = attempts.filter(
    (a) => a.headSha === task.prHeadSha && a.status === 'COMPLETED_VERDICT',
  );
  const latest = atHead[atHead.length - 1];
  return latest !== undefined && isCleanVerdict(latest, policy);
}

export type VerdictOutcome =
  | { kind: 'CLEAN' }
  | { kind: 'NEEDS_FIX'; remainingRounds: number }
  | { kind: 'BUDGET_EXHAUSTED'; maxRounds: number }
  | { kind: 'NO_VERDICT' };

/**
 * Classify a review attempt against policy and the remaining budget. This is
 * the sole input to the CODEX_VERDICT transition target.
 */
export function classifyVerdict(
  task: Task,
  attempt: ReviewAttempt,
  priorAttempts: readonly ReviewAttempt[],
  policy: Policy,
): VerdictOutcome {
  if (attempt.status !== 'COMPLETED_VERDICT') return { kind: 'NO_VERDICT' };
  if (isCleanVerdict(attempt, policy)) return { kind: 'CLEAN' };

  const budget = reviewBudget(task, [...priorAttempts, attempt], policy);
  if (budget.exhausted) return { kind: 'BUDGET_EXHAUSTED', maxRounds: budget.maxRounds };
  return { kind: 'NEEDS_FIX', remainingRounds: budget.remainingRounds };
}
