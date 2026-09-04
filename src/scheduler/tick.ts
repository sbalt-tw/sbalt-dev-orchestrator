/**
 * Scheduler tick.
 *
 * One tick is a single deterministic pass over durable state:
 *
 *   1. reconcile stale worker leases
 *   2. re-evaluate dependency readiness
 *   3. pick candidate tasks by priority, then age
 *   4. respect the concurrency ceiling and each lane's active-PR limit
 *   5. match a worker by capability
 *   6. acquire the logical resources the task declares
 *   7. create a worker lease and move the task to RUNNING
 *
 * A tick produces dispatch intents rather than running anything itself. That
 * keeps the orchestration semantics testable without a real worker, and keeps
 * the state write and the side effect separable.
 *
 * Each dispatch commits inside one BEGIN IMMEDIATE transaction that re-reads
 * every limit it is about to consume. Checking capacity, the concurrency
 * ceiling and the lane slot in separate autocommit statements let two scheduler
 * processes both see room and both commit, and left a partially acquired
 * resource stranded if anything failed in between.
 *
 * Not every READY task gets a worker. Concurrency, lane limits and resource
 * capacity all legitimately hold a task back, and doing so is recorded rather
 * than silent.
 */

import type { Task } from '../domain/entities.js';
import type { Store } from '../state/store.js';
import type { StateEngine } from '../state/engine.js';
import type { ResourceManager } from '../resources/manager.js';
import type { Policy } from '../policy/schema.js';
import { dependenciesSatisfied } from './dependencies.js';
import { reconcileStaleLeases, type ReconcileResult } from './reconcile.js';
import { workerMatches } from '../workers/provider.js';

/** Task states that occupy one of a lane's active implementation PR slots. */
const ACTIVE_PR_STATES = new Set<Task['state']>([
  'RUNNING',
  'WAITING_CI',
  'WAITING_REVIEW',
  'REVIEW_FIX',
  'READY_TO_MERGE',
]);

export interface DispatchIntent {
  taskId: string;
  laneId: string;
  workerId: string;
  leaseId: string;
  resourceLeaseIds: string[];
}

export interface SkippedTask {
  taskId: string;
  reason: string;
}

export interface TickResult {
  reconcile: ReconcileResult;
  readied: string[];
  waitingDependency: string[];
  dispatched: DispatchIntent[];
  skipped: SkippedTask[];
}

/**
 * Thrown to roll a dispatch attempt back.
 *
 * Returning a failure from inside the transaction would commit whatever had
 * already been written; throwing discards it, and the reason is recorded
 * afterwards.
 */
class DispatchAbort extends Error {
  constructor(public readonly detail: string) {
    super(detail);
    this.name = 'DispatchAbort';
  }
}

function laneActivePrCount(store: Store, laneId: string): number {
  return store
    .listTasks({ laneId })
    .filter((t) => t.taskType === 'IMPLEMENTATION' && t.requiresPr && ACTIVE_PR_STATES.has(t.state))
    .length;
}

export function tick(
  store: Store,
  engine: StateEngine,
  resources: ResourceManager,
  policy: Policy,
  now: Date,
): TickResult {
  const result: TickResult = {
    reconcile: {
      staleLeases: 0,
      tasksBlocked: [],
      resourcesReleased: 0,
      orphanedRunningTasks: [],
      orphanedResourceLeases: 0,
    },
    readied: [],
    waitingDependency: [],
    dispatched: [],
    skipped: [],
  };

  // 1. stale leases first: they free workers and resources this tick can reuse.
  result.reconcile = reconcileStaleLeases(store, engine, resources, now);

  // 2. dependency readiness.
  for (const task of [...store.listTasks({ state: 'QUEUED' }), ...store.listTasks({ state: 'WAITING_DEPENDENCY' })]) {
    const satisfied = dependenciesSatisfied(store, task.id);
    if (satisfied && task.state !== 'READY') {
      const applied = engine.apply({
        taskId: task.id,
        event: 'DEPENDENCIES_SATISFIED',
        actor: 'scheduler',
      });
      if (applied.ok) result.readied.push(task.id);
    } else if (!satisfied && task.state === 'QUEUED') {
      const applied = engine.apply({
        taskId: task.id,
        event: 'DEPENDENCIES_UNSATISFIED',
        actor: 'scheduler',
      });
      if (applied.ok) result.waitingDependency.push(task.id);
    } else if (!satisfied) {
      result.waitingDependency.push(task.id);
    }
  }

  // 3. candidates: newly READY plus tasks awaiting rework, highest priority
  //    first and oldest first within a priority.
  const candidates = [...store.listTasks({ state: 'READY' }), ...store.listTasks({ state: 'REVIEW_FIX' })].sort(
    (a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );

  for (const candidate of candidates) {
    let outcome: DispatchOutcome;
    try {
      outcome = dispatchOne(store, engine, resources, policy, candidate.id);
    } catch (err) {
      if (!(err instanceof DispatchAbort)) throw err;
      outcome = { kind: 'skipped', reason: err.detail };
      // The rollback undid the acquisition; record why outside the transaction.
      engine.apply({
        taskId: candidate.id,
        event: 'RESOURCE_UNAVAILABLE',
        actor: 'scheduler',
        payload: { detail: err.detail },
      });
    }
    if (outcome.kind === 'dispatched') result.dispatched.push(outcome.intent);
    else if (outcome.kind === 'waiting') result.waitingDependency.push(candidate.id);
    else result.skipped.push({ taskId: candidate.id, reason: outcome.reason });
  }

  return result;
}

type DispatchOutcome =
  | { kind: 'dispatched'; intent: DispatchIntent }
  | { kind: 'skipped'; reason: string }
  | { kind: 'waiting' };

/**
 * Attempt one dispatch atomically.
 *
 * Everything the decision rests on is re-read inside the transaction: the
 * task's current state, its dependencies, the concurrency ceiling, the lane
 * slot, worker availability and resource capacity. A task that became
 * ineligible since the candidate list was built is caught here rather than
 * dispatched on stale information.
 */
function dispatchOne(
  store: Store,
  engine: StateEngine,
  resources: ResourceManager,
  policy: Policy,
  taskId: string,
): DispatchOutcome {
  return store.immediateTransaction((): DispatchOutcome => {
    const task = store.getTask(taskId);
    if (!task) return { kind: 'skipped', reason: 'task disappeared' };
    if (task.state !== 'READY' && task.state !== 'REVIEW_FIX') {
      return { kind: 'skipped', reason: `task is ${task.state}; no longer a candidate` };
    }

    // Dependencies are re-checked for every candidate, not only for QUEUED
    // tasks. A dependency added after a task became READY, or an upstream that
    // left its required state while this one waited for capacity, would
    // otherwise let contradictory work run.
    if (!dependenciesSatisfied(store, task.id)) {
      const applied = engine.apply({
        taskId: task.id,
        event: 'DEPENDENCIES_UNSATISFIED',
        actor: 'scheduler',
        payload: { detected: 'at dispatch time' },
      });
      return applied.ok
        ? { kind: 'waiting' }
        : { kind: 'skipped', reason: `dependencies unsatisfied: ${applied.reason}` };
    }

    // Defence in depth. The state machine should already keep a gated task out
    // of READY, but a task must never reach a worker while a decision on it is
    // unanswered, whatever route it took to get here.
    const outstanding = store.outstandingDecisions(task.id);
    if (outstanding.length > 0) {
      return {
        kind: 'skipped',
        reason: `${outstanding.length} founder decision(s) outstanding: ${outstanding
          .map((d) => d.category)
          .join(', ')}`,
      };
    }

    if (store.listActiveWorkerLeases().length >= policy.workers.maxConcurrent) {
      return {
        kind: 'skipped',
        reason: `worker concurrency ceiling reached (${policy.workers.maxConcurrent})`,
      };
    }

    const lane = store.getLane(task.laneId);
    if (!lane) return { kind: 'skipped', reason: 'lane not found' };
    if (lane.status !== 'ACTIVE') return { kind: 'skipped', reason: `lane is ${lane.status}` };

    // Lane active-PR limit. A task already occupying a slot (REVIEW_FIX) may
    // continue; a fresh one may not open a second concurrent PR.
    if (task.taskType === 'IMPLEMENTATION' && task.requiresPr && !ACTIVE_PR_STATES.has(task.state)) {
      const active = laneActivePrCount(store, lane.id);
      if (active >= lane.maxActiveImplementationPrs) {
        const reason = `lane '${lane.name}' already has ${active} active implementation PR task(s); limit is ${lane.maxActiveImplementationPrs}`;
        store.appendEvent({
          taskId: task.id,
          eventType: 'LANE_PR_LIMIT_REACHED',
          actor: 'scheduler',
          fromState: task.state,
          toState: task.state,
          payload: { laneId: lane.id, active, limit: lane.maxActiveImplementationPrs },
        });
        return { kind: 'skipped', reason };
      }
    }

    // 5. capability match against an idle worker.
    const worker = store
      .listWorkers('IDLE')
      .find((w) => workerMatches(w.capabilities, task.requiredCapabilities));
    if (!worker) {
      return {
        kind: 'skipped',
        reason:
          task.requiredCapabilities.length > 0
            ? `no idle worker with capabilities [${task.requiredCapabilities.join(', ')}]`
            : 'no idle worker available',
      };
    }

    // 6. resources. All-or-nothing. The transaction rolls back a partial
    //    acquisition, so a scarce slot can never be stranded by a task that
    //    never ran.
    const acquired: string[] = [];
    for (const resourceName of task.requiredResources) {
      const outcome = resources.acquire({ resourceName, task, workerId: worker.id });
      if (!outcome.ok) {
        const reason = `${outcome.reason}: ${outcome.detail}`;
        // Roll the whole attempt back, then record the reason outside it.
        throw new DispatchAbort(reason);
      }
      if (!outcome.alreadyHeld) acquired.push(outcome.lease.id);
    }

    // 7. lease + state transition, then emit the dispatch intent.
    const lease = store.createWorkerLease({
      taskId: task.id,
      workerId: worker.id,
      ttlMs: policy.workers.leaseTtlMs,
    });
    store.setWorkerStatus(worker.id, 'BUSY');

    const applied = engine.apply({
      taskId: task.id,
      event: 'WORKER_ASSIGNED',
      actor: 'scheduler',
      payload: { workerId: worker.id, leaseId: lease.id },
    });
    if (!applied.ok) throw new DispatchAbort(applied.reason);

    return {
      kind: 'dispatched',
      intent: {
        taskId: task.id,
        laneId: task.laneId,
        workerId: worker.id,
        leaseId: lease.id,
        resourceLeaseIds: acquired,
      },
    };
  });
}
