/**
 * Deterministic state engine.
 *
 * This is the only component allowed to change a task's state. Every call
 * names an event; the engine checks that the event is legal from the current
 * state, evaluates the guards that apply to it, writes the new state and the
 * history row in one transaction, and returns a structured result.
 *
 * Nothing here trusts a caller's assertion. "Dependencies are satisfied" is
 * verified against the dependency rows; "this is ready to merge" is verified
 * against a clean verdict at the exact current head and a resolved Founder
 * decision. A worker or Coordinator that claims otherwise is simply rejected.
 */

import type { TaskEvent, TaskState } from '../domain/states.js';
import { allowedTargets, isTerminal } from '../domain/states.js';
import type { Store } from './store.js';
import type { Policy } from '../policy/schema.js';
import { checkGate, continuationFor, requireDecision } from '../policy/founderGate.js';
import { classifyVerdict, cleanAtCurrentHead } from '../policy/review.js';
import { dependenciesSatisfied } from '../scheduler/dependencies.js';

export interface ApplyEventInput {
  taskId: string;
  event: TaskEvent;
  actor: string;
  /** Required when the (state, event) pair permits more than one target. */
  target?: TaskState;
  payload?: Record<string, unknown>;
}

export type ApplyResult =
  | { ok: true; from: TaskState; to: TaskState; note?: string }
  | { ok: false; from: TaskState; reason: string };

export class StateEngine {
  constructor(
    private readonly store: Store,
    private readonly policy: Policy,
  ) {}

  apply(input: ApplyEventInput): ApplyResult {
    return this.store.transaction(() => this.applyInner(input));
  }

  private reject(from: TaskState, reason: string, input: ApplyEventInput): ApplyResult {
    this.store.appendEvent({
      taskId: input.taskId,
      eventType: `REJECTED:${input.event}`,
      actor: input.actor,
      fromState: from,
      toState: null,
      payload: { reason, requestedTarget: input.target ?? null, ...(input.payload ?? {}) },
    });
    return { ok: false, from, reason };
  }

  private applyInner(input: ApplyEventInput): ApplyResult {
    const task = this.store.getTask(input.taskId);
    if (!task) {
      // No task row means no state to record against; surface it directly.
      return { ok: false, from: 'QUEUED', reason: `unknown task: ${input.taskId}` };
    }
    const from = task.state;

    if (isTerminal(from)) {
      return this.reject(from, `task is terminal in ${from}; no transition is possible`, input);
    }

    const targets = allowedTargets(from, input.event);
    if (targets.length === 0) {
      return this.reject(from, `event ${input.event} is not allowed from ${from}`, input);
    }

    // --- resolve the target -------------------------------------------------
    //
    // Every multi-target event resolves deterministically from persisted data.
    // Letting the caller pick among allowed targets would mean an architecture
    // approval could drive a task to READY_TO_MERGE, so the caller may only
    // confirm what the engine computes.
    let target: TaskState;
    let note: string | undefined;

    if (input.event === 'CODEX_VERDICT') {
      const resolved = this.resolveVerdictTarget(input);
      if (!resolved.ok) return this.reject(from, resolved.reason, input);
      target = resolved.target;
      note = resolved.note;
    } else if (input.event === 'FOUNDER_DECISION_RESOLVED') {
      const resolved = this.resolveFounderTarget(input);
      if (!resolved.ok) return this.reject(from, resolved.reason, input);
      target = resolved.target;
      note = resolved.note;
    } else if (input.event === 'RECOVERED') {
      const resolved = this.resolveRecoveredTarget(input);
      if (!resolved.ok) return this.reject(from, resolved.reason, input);
      target = resolved.target;
      note = resolved.note;
    } else if (input.event === 'WORKER_FAILED') {
      const resolved = this.resolveWorkerFailedTarget(input);
      if (!resolved.ok) return this.reject(from, resolved.reason, input);
      target = resolved.target;
      note = resolved.note;
    } else if (targets.length === 1) {
      const only = targets[0];
      if (!only) return this.reject(from, 'internal: empty transition target', input);
      target = only;
    } else {
      if (!input.target) {
        return this.reject(
          from,
          `event ${input.event} from ${from} is ambiguous; an explicit target is required (one of ${targets.join(', ')})`,
          input,
        );
      }
      target = input.target;
    }

    if (!targets.includes(target)) {
      return this.reject(
        from,
        `transition ${from} --${input.event}--> ${target} is not allowed (allowed: ${targets.join(', ')})`,
        input,
      );
    }
    if (input.target && input.target !== target) {
      return this.reject(
        from,
        `requested target ${input.target} contradicts the computed target ${target}`,
        input,
      );
    }

    // --- guards -------------------------------------------------------------
    const guard = this.checkGuards(input, target);
    if (!guard.ok) return this.reject(from, guard.reason, input);

    // --- commit -------------------------------------------------------------
    // Everything below runs inside the same transaction as the caller's
    // `apply`, so the state change, its history row and any decision it
    // creates land together or not at all.
    this.store.setTaskState(task.id, target);
    this.store.appendEvent({
      taskId: task.id,
      eventType: input.event,
      actor: input.actor,
      fromState: from,
      toState: target,
      payload: { ...(input.payload ?? {}), ...(note ? { note } : {}) },
    });

    if (input.event === 'INFRA_FAILURE') {
      // Remember where the work was interrupted so RECOVERED has somewhere
      // definite to return to.
      this.store.setPreInfraState(task.id, from);
    }

    if (input.event === 'CODEX_VERDICT' && target === 'FOUNDER_DECISION') {
      // A task parked on an exhausted review budget needs something to
      // resolve. Without this row it would sit in FOUNDER_DECISION with an
      // empty decision list and no way forward.
      const decision = requireDecision(
        this.store,
        this.store.requireTask(task.id),
        'review_budget_extension',
        `Review budget exhausted for "${task.title}" with findings outstanding. Extend the budget, or decide otherwise?`,
        input.actor,
      );
      this.store.appendEvent({
        taskId: task.id,
        eventType: 'FOUNDER_DECISION_REQUIRED',
        actor: input.actor,
        fromState: target,
        toState: target,
        payload: { category: 'review_budget_extension', decisionId: decision.id },
      });
    }

    return note ? { ok: true, from, to: target, note } : { ok: true, from, to: target };
  }

  /**
   * The destination of a resolved Founder decision comes from the decision row
   * itself: which task it belongs to, and the target recorded when it was
   * resolved. A decision on another task, or one still REQUIRED, resolves
   * nothing.
   */
  private resolveFounderTarget(
    input: ApplyEventInput,
  ): { ok: true; target: TaskState; note: string } | { ok: false; reason: string } {
    const decisionId = input.payload?.['decisionId'];
    if (typeof decisionId !== 'string') {
      return { ok: false, reason: 'FOUNDER_DECISION_RESOLVED requires payload.decisionId' };
    }
    const decision = this.store.getFounderDecision(decisionId);
    if (!decision) return { ok: false, reason: `unknown founder decision: ${decisionId}` };
    if (decision.taskId !== input.taskId) {
      return {
        ok: false,
        reason: `founder decision ${decisionId} belongs to task ${decision.taskId ?? 'none'}, not ${input.taskId}`,
      };
    }
    if (decision.state !== 'RESOLVED') {
      return { ok: false, reason: `founder decision ${decisionId} is ${decision.state}, not RESOLVED` };
    }

    const all = this.store.listFounderDecisions({ taskId: input.taskId });
    const outstanding = all.filter((d) => d.state === 'REQUIRED');
    if (outstanding.length > 0) {
      return {
        ok: false,
        reason: `${outstanding.length} founder decision(s) still outstanding on this task`,
      };
    }

    // Derived from every decision on the task, not from the one just answered:
    // a refusal must not be overridden because an approval was written after it.
    const continuation = continuationFor(all);
    return {
      ok: true,
      target: continuation.target,
      note: `${decision.category} decision ${decisionId} resolved; ${continuation.reason}`,
    };
  }

  /**
   * Recovery returns a task to where it was interrupted, not to wherever the
   * caller would prefer. A task interrupted while RUNNING goes back to QUEUED
   * so dependencies and capacity are re-evaluated before it runs again.
   */
  private resolveRecoveredTarget(
    input: ApplyEventInput,
  ): { ok: true; target: TaskState; note: string } | { ok: false; reason: string } {
    // A task still owing a human an answer comes back owing it. Recovery
    // restores where the work was; it never clears an authorisation, and an
    // interruption is not a way to escape a gate.
    if (this.store.outstandingDecisions(input.taskId).length > 0) {
      return {
        ok: true,
        target: 'FOUNDER_DECISION',
        note: 'recovered still awaiting an unresolved founder decision',
      };
    }
    const pre = this.store.getPreInfraState(input.taskId);
    const target: TaskState =
      pre === 'WAITING_REVIEW' || pre === 'WAITING_CI' || pre === 'REVIEW_FIX' || pre === 'FOUNDER_DECISION'
        ? pre
        : 'QUEUED';
    if (target === 'FOUNDER_DECISION') {
      return { ok: true, target, note: 'recovered to the founder gate it was interrupted at' };
    }
    return {
      ok: true,
      target,
      note: pre ? `recovered to the state interrupted by infrastructure (${pre})` : 'recovered to QUEUED',
    };
  }

  /**
   * A worker failure is infrastructure or it is the work. The report says
   * which; the engine does not guess.
   */
  private resolveWorkerFailedTarget(
    input: ApplyEventInput,
  ): { ok: true; target: TaskState; note: string } | { ok: false; reason: string } {
    const kind = input.payload?.['errorKind'];
    if (kind !== 'INFRA' && kind !== 'TASK') {
      return { ok: false, reason: "WORKER_FAILED requires payload.errorKind of 'INFRA' or 'TASK'" };
    }
    return kind === 'INFRA'
      ? { ok: true, target: 'BLOCKED_INFRA', note: 'worker failed for an infrastructure reason' }
      : { ok: true, target: 'REVIEW_FIX', note: 'worker failed on the work itself' };
  }

  private resolveVerdictTarget(
    input: ApplyEventInput,
  ): { ok: true; target: TaskState; note: string } | { ok: false; reason: string } {
    const attemptId = input.payload?.['reviewAttemptId'];
    if (typeof attemptId !== 'string') {
      return { ok: false, reason: 'CODEX_VERDICT requires payload.reviewAttemptId' };
    }
    const task = this.store.requireTask(input.taskId);
    const attempts = this.store.listReviewAttempts(task.id);
    const attempt = attempts.find((a) => a.id === attemptId);
    if (!attempt) {
      return { ok: false, reason: `unknown review attempt: ${attemptId}` };
    }
    if (attempt.status !== 'COMPLETED_VERDICT') {
      return {
        ok: false,
        reason: `review attempt ${attemptId} has status ${attempt.status}; only a completed verdict may drive CODEX_VERDICT`,
      };
    }
    const prior = attempts.filter((a) => a.id !== attempt.id);
    const outcome = classifyVerdict(task, attempt, prior, this.policy);
    switch (outcome.kind) {
      case 'CLEAN':
        return {
          ok: true,
          target: 'READY_TO_MERGE',
          note: `clean verdict at ${attempt.headSha} (round ${attempt.round})`,
        };
      case 'NEEDS_FIX':
        return {
          ok: true,
          target: 'REVIEW_FIX',
          note: `blocker=${attempt.blocker} high=${attempt.high}; ${outcome.remainingRounds} round(s) remaining`,
        };
      case 'BUDGET_EXHAUSTED':
        return {
          ok: true,
          target: 'FOUNDER_DECISION',
          note: `review budget of ${outcome.maxRounds} completed round(s) exhausted with findings outstanding`,
        };
      case 'NO_VERDICT':
        return { ok: false, reason: 'review attempt produced no verdict' };
      default:
        return { ok: false, reason: 'unclassified verdict' };
    }
  }

  private checkGuards(
    input: ApplyEventInput,
    target: TaskState,
  ): { ok: true } | { ok: false; reason: string } {
    const task = this.store.requireTask(input.taskId);

    switch (input.event) {
      case 'DEPENDENCIES_SATISFIED': {
        if (!dependenciesSatisfied(this.store, task.id)) {
          return {
            ok: false,
            reason: 'dependencies are not satisfied; the claim contradicts the dependency graph',
          };
        }
        return { ok: true };
      }

      case 'DEPENDENCIES_UNSATISFIED': {
        if (dependenciesSatisfied(this.store, task.id)) {
          return {
            ok: false,
            reason: 'all dependencies are satisfied; cannot move to WAITING_DEPENDENCY',
          };
        }
        return { ok: true };
      }

      case 'WORKER_COMPLETED': {
        if (task.requiresPr) {
          return {
            ok: false,
            reason:
              'task requires a PR; WORKER_COMPLETED cannot take it straight to DONE. Report PR_OPENED instead.',
          };
        }
        return { ok: true };
      }

      case 'FOUNDER_DECISION_RESOLVED': {
        // Ownership, state and destination are all verified while resolving the
        // target, so there is nothing left to re-check here.
        return { ok: true };
      }

      case 'MERGED': {
        const gate = checkGate(this.store, this.policy, task, 'merge');
        if (gate.required && !gate.satisfied) {
          return { ok: false, reason: `merge is founder-gated: ${gate.reason}` };
        }
        if (!task.prHeadSha) {
          return { ok: false, reason: 'task has no recorded PR head; merge readiness is unverifiable' };
        }
        const attempts = this.store.listReviewAttempts(task.id);
        if (!cleanAtCurrentHead(task, attempts, this.policy)) {
          return {
            ok: false,
            reason: `no clean completed verdict at the exact current head ${task.prHeadSha}`,
          };
        }
        return { ok: true };
      }

      case 'MERGE_READY': {
        const attempts = this.store.listReviewAttempts(task.id);
        if (!cleanAtCurrentHead(task, attempts, this.policy)) {
          return {
            ok: false,
            reason: 'merge readiness requires a clean completed verdict at the current head',
          };
        }
        return { ok: true };
      }

      case 'WORKER_ASSIGNED': {
        const lease = this.store.getActiveWorkerLeaseForTask(task.id);
        if (!lease) {
          return {
            ok: false,
            reason: 'WORKER_ASSIGNED requires an active worker lease for the task',
          };
        }
        return { ok: true };
      }

      default:
        void target;
        return { ok: true };
    }
  }
}
