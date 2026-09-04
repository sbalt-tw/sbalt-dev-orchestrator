/**
 * Coordinator output validation.
 *
 * The Coordinator proposes; this module disposes. Every action is checked
 * against the durable state and the policy before the orchestrator will act on
 * it, so a confused or manipulated reasoning component can slow work down but
 * cannot merge, deploy, or skip a gate.
 *
 * Malformed output is rejected outright rather than coerced: an action the
 * schema does not recognise is a bug or an attack, not a hint.
 */

import {
  coordinatorOutputSchema,
  type CoordinatorOutput,
  type CoordinatorValidation,
} from '../domain/coordinator.js';
import type { Task } from '../domain/entities.js';
import type { Store } from '../state/store.js';
import type { Policy } from '../policy/schema.js';
import { cleanAtCurrentHead } from '../policy/review.js';
import { dependenciesSatisfied } from '../scheduler/dependencies.js';

export type CoordinatorParseResult =
  | { ok: true; output: CoordinatorOutput }
  | { ok: false; reason: string; issues: string[] };

/** Fail-closed parse of raw Coordinator output. */
export function parseCoordinatorOutput(raw: unknown): CoordinatorParseResult {
  const parsed = coordinatorOutputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, output: parsed.data };
  return {
    ok: false,
    reason: 'coordinator output failed schema validation',
    issues: parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
  };
}

export function validateCoordinatorAction(
  store: Store,
  policy: Policy,
  task: Task,
  output: CoordinatorOutput,
): CoordinatorValidation {
  switch (output.action) {
    case 'NOOP':
    case 'BLOCK_INFRA':
      return { allowed: true, reason: 'always permitted' };

    case 'WAIT_DEPENDENCY': {
      if (dependenciesSatisfied(store, task.id)) {
        return {
          allowed: false,
          reason: 'all dependencies are satisfied; waiting would stall the task',
        };
      }
      return { allowed: true, reason: 'dependencies outstanding' };
    }

    case 'CONTINUE_WORKER': {
      const workable: Task['state'][] = ['READY', 'RUNNING', 'REVIEW_FIX', 'QUEUED'];
      if (!workable.includes(task.state)) {
        return {
          allowed: false,
          reason: `task is ${task.state}; a worker cannot continue from there`,
        };
      }
      return { allowed: true, reason: 'task is workable' };
    }

    case 'REQUEST_REVIEW': {
      if (!task.prNumber || !task.prHeadSha) {
        return { allowed: false, reason: 'review requires an open PR with a known head' };
      }
      if (task.ciStatus !== 'PASSED') {
        return { allowed: false, reason: `CI is ${task.ciStatus}; review requires CI PASSED` };
      }
      return { allowed: true, reason: 'PR present and CI green' };
    }

    case 'FOUNDER_DECISION': {
      if (!output.params?.founderCategory) {
        return { allowed: false, reason: 'FOUNDER_DECISION requires params.founderCategory' };
      }
      if (!output.params.founderQuestion) {
        return { allowed: false, reason: 'FOUNDER_DECISION requires params.founderQuestion' };
      }
      return { allowed: true, reason: 'decision request is well formed' };
    }

    case 'SPAWN_TASK': {
      if (!output.params?.spawnTitle || !output.params.spawnTaskType) {
        return {
          allowed: false,
          reason: 'SPAWN_TASK requires params.spawnTitle and params.spawnTaskType',
        };
      }
      return { allowed: true, reason: 'spawn request is well formed' };
    }

    case 'READY_TO_MERGE': {
      const attempts = store.listReviewAttempts(task.id);
      if (!cleanAtCurrentHead(task, attempts, policy)) {
        return {
          allowed: false,
          reason:
            'no clean completed verdict at the exact current head; merge readiness cannot be asserted',
        };
      }
      return {
        allowed: true,
        reason: 'clean verdict at current head (merge itself remains founder-gated)',
      };
    }

    default: {
      // Unreachable while the schema and this switch agree; fail closed anyway.
      return { allowed: false, reason: `unknown coordinator action` };
    }
  }
}
