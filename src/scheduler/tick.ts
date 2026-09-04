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
    reconcile: { staleLeases: 0, tasksBlocked: [], resourcesReleased: 0 },
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

  // 4. concurrency ceiling.
  let activeLeases = store.listActiveWorkerLeases().length;

  for (const task of candidates) {
    if (activeLeases >= policy.workers.maxConcurrent) {
      result.skipped.push({
        taskId: task.id,
        reason: `worker concurrency ceiling reached (${policy.workers.maxConcurrent})`,
      });
      continue;
    }

    const lane = store.getLane(task.laneId);
    if (!lane) {
      result.skipped.push({ taskId: task.id, reason: 'lane not found' });
      continue;
    }
    if (lane.status !== 'ACTIVE') {
      result.skipped.push({ taskId: task.id, reason: `lane is ${lane.status}` });
      continue;
    }

    // Lane active-PR limit. A task already occupying a slot (REVIEW_FIX) may
    // continue; a fresh one may not open a second concurrent PR.
    if (task.taskType === 'IMPLEMENTATION' && task.requiresPr && !ACTIVE_PR_STATES.has(task.state)) {
      const active = laneActivePrCount(store, lane.id);
      if (active >= lane.maxActiveImplementationPrs) {
        const reason = `lane '${lane.name}' already has ${active} active implementation PR task(s); limit is ${lane.maxActiveImplementationPrs}`;
        result.skipped.push({ taskId: task.id, reason });
        store.appendEvent({
          taskId: task.id,
          eventType: 'LANE_PR_LIMIT_REACHED',
          actor: 'scheduler',
          fromState: task.state,
          toState: task.state,
          payload: { laneId: lane.id, active, limit: lane.maxActiveImplementationPrs },
        });
        continue;
      }
    }

    // 5. capability match against an idle worker.
    const worker = store
      .listWorkers('IDLE')
      .find((w) => workerMatches(w.capabilities, task.requiredCapabilities));
    if (!worker) {
      result.skipped.push({
        taskId: task.id,
        reason:
          task.requiredCapabilities.length > 0
            ? `no idle worker with capabilities [${task.requiredCapabilities.join(', ')}]`
            : 'no idle worker available',
      });
      continue;
    }

    // 6. resources. All-or-nothing: a partial acquisition is rolled back so a
    //    task cannot sit on a scarce slot it cannot use.
    const acquired: string[] = [];
    let resourceFailure: string | null = null;
    for (const resourceName of task.requiredResources) {
      const outcome = resources.acquire({ resourceName, task, workerId: worker.id });
      if (outcome.ok) {
        if (!outcome.alreadyHeld) acquired.push(outcome.lease.id);
      } else {
        resourceFailure = `${outcome.reason}: ${outcome.detail}`;
        break;
      }
    }
    if (resourceFailure) {
      for (const leaseId of acquired) resources.release(leaseId);
      result.skipped.push({ taskId: task.id, reason: resourceFailure });
      engine.apply({
        taskId: task.id,
        event: 'RESOURCE_UNAVAILABLE',
        actor: 'scheduler',
        payload: { detail: resourceFailure },
      });
      continue;
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
    if (!applied.ok) {
      store.closeWorkerLease(lease.id, 'RELEASED');
      store.setWorkerStatus(worker.id, 'IDLE');
      for (const leaseId of acquired) resources.release(leaseId);
      result.skipped.push({ taskId: task.id, reason: applied.reason });
      continue;
    }

    activeLeases += 1;
    result.dispatched.push({
      taskId: task.id,
      laneId: task.laneId,
      workerId: worker.id,
      leaseId: lease.id,
      resourceLeaseIds: acquired,
    });
  }

  return result;
}
