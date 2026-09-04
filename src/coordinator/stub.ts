/**
 * Deterministic Coordinator stub.
 *
 * Phase 0 has no live model call. This stub applies the obvious rules so the
 * end-to-end plumbing — snapshot in, structured action out, validation, then
 * execution — can be exercised and tested without a network.
 *
 * Swapping in a real GPT Coordinator means implementing the same interface; the
 * validation layer around it does not change.
 */

import type {
  Coordinator,
  CoordinatorOutput,
  CoordinatorSnapshot,
} from '../domain/coordinator.js';

export class StubCoordinator implements Coordinator {
  readonly name = 'stub';

  async decide(snapshot: CoordinatorSnapshot): Promise<CoordinatorOutput> {
    const { task, dependencies, review, policy } = snapshot;

    if (dependencies.some((d) => !d.satisfied)) {
      return { action: 'WAIT_DEPENDENCY', reason: 'one or more dependencies are unmet' };
    }

    switch (task.state) {
      case 'QUEUED':
      case 'READY':
      case 'REVIEW_FIX':
        return { action: 'CONTINUE_WORKER', reason: `task is ${task.state} and workable` };

      case 'RUNNING':
        return { action: 'NOOP', reason: 'a worker already holds this task' };

      case 'WAITING_CI':
        return { action: 'NOOP', reason: 'waiting for CI to report' };

      case 'WAITING_REVIEW': {
        if (task.ciStatus === 'PASSED' && task.prNumber) {
          return { action: 'REQUEST_REVIEW', reason: 'PR is green and awaiting review' };
        }
        return { action: 'NOOP', reason: 'review cannot start until CI passes' };
      }

      case 'READY_TO_MERGE': {
        if (policy.mergeRequiresFounder) {
          return {
            action: 'FOUNDER_DECISION',
            reason: 'merge is founder-gated by policy',
            params: {
              founderCategory: 'merge',
              founderQuestion: `Merge "${task.title}" at head ${task.prHeadSha ?? 'unknown'}?`,
            },
          };
        }
        return { action: 'READY_TO_MERGE', reason: 'clean at current head and merge is not gated' };
      }

      case 'FOUNDER_DECISION':
        return { action: 'NOOP', reason: 'awaiting a Founder decision' };

      case 'BLOCKED_INFRA':
        return { action: 'BLOCK_INFRA', reason: 'infrastructure failure is unresolved' };

      case 'BLOCKED_POLICY':
        return { action: 'NOOP', reason: 'blocked by policy; a Founder decision is required' };

      case 'WAITING_DEPENDENCY':
        return { action: 'WAIT_DEPENDENCY', reason: 'dependencies outstanding' };

      case 'DONE':
      case 'CANCELLED':
        return { action: 'NOOP', reason: `task is terminal in ${task.state}` };

      default: {
        void review;
        return { action: 'NOOP', reason: 'no rule matched' };
      }
    }
  }
}
