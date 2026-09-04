/**
 * Crash and restart reconciliation.
 *
 * The orchestrator is a process; processes die. When one dies mid-dispatch, the
 * database is left holding a task in RUNNING with an ACTIVE worker lease and no
 * worker behind it.
 *
 * The dangerous assumption would be that RUNNING means the work finished. It
 * does not, and this module never treats it that way. A lease whose expiry has
 * passed is marked STALE, its resources are handed back, its worker is released,
 * and the task is moved to BLOCKED_INFRA — visible, recoverable, and explicitly
 * not silently re-dispatched into a second concurrent execution.
 *
 * Recovery from BLOCKED_INFRA is a deliberate RECOVERED event, not an automatic
 * side effect, so an operator or policy decides when re-running is safe.
 */

import type { Store } from '../state/store.js';
import type { StateEngine } from '../state/engine.js';
import type { ResourceManager } from '../resources/manager.js';

export interface ReconcileResult {
  staleLeases: number;
  tasksBlocked: string[];
  resourcesReleased: number;
}

export function reconcileStaleLeases(
  store: Store,
  engine: StateEngine,
  resources: ResourceManager,
  now: Date,
): ReconcileResult {
  const result: ReconcileResult = { staleLeases: 0, tasksBlocked: [], resourcesReleased: 0 };

  for (const lease of store.listActiveWorkerLeases()) {
    if (new Date(lease.expiresAt).getTime() > now.getTime()) continue;

    store.closeWorkerLease(lease.id, 'STALE');
    result.staleLeases += 1;
    store.setWorkerStatus(lease.workerId, 'IDLE');
    result.resourcesReleased += resources.releaseAllForTask(lease.taskId);

    const task = store.getTask(lease.taskId);
    if (!task) continue;

    store.appendEvent({
      taskId: task.id,
      eventType: 'WORKER_LEASE_STALE',
      actor: 'reconciler',
      fromState: task.state,
      toState: task.state,
      payload: { leaseId: lease.id, workerId: lease.workerId, expiresAt: lease.expiresAt },
    });

    if (task.state === 'RUNNING') {
      const applied = engine.apply({
        taskId: task.id,
        event: 'INFRA_FAILURE',
        actor: 'reconciler',
        payload: {
          cause: 'worker lease expired without a report',
          leaseId: lease.id,
        },
      });
      if (applied.ok) result.tasksBlocked.push(task.id);
    }
  }

  return result;
}
