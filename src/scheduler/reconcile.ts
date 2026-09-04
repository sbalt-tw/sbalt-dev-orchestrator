/**
 * Crash and restart reconciliation.
 *
 * The orchestrator is a process; processes die. When one dies mid-dispatch, the
 * database is left holding a task in `RUNNING` with an `ACTIVE` worker lease and
 * no worker behind it.
 *
 * The dangerous assumption would be that `RUNNING` means the work finished. It
 * does not, and this module never treats it that way. A lease whose expiry has
 * passed is marked stale, its resources are handed back, its worker is released,
 * and the task is moved to `BLOCKED_INFRA` — visible, recoverable, and
 * explicitly not silently re-dispatched into a second concurrent execution.
 *
 * Each lease is reconciled inside one transaction. Doing it in steps meant a
 * crash between "close the lease" and "block the task" left a task `RUNNING`
 * with no active lease: invisible to lease-based reconciliation forever, so
 * neither blocked nor recoverable. Two further sweeps close the remaining gaps —
 * tasks found `RUNNING` with no lease at all, and resource leases still held by
 * tasks that are neither running nor leased.
 *
 * Recovery from `BLOCKED_INFRA` is a deliberate RECOVERED event, not an
 * automatic side effect, so an operator or policy decides when re-running is
 * safe.
 */

import type { Store } from '../state/store.js';
import type { StateEngine } from '../state/engine.js';
import type { ResourceManager } from '../resources/manager.js';

export interface ReconcileResult {
  staleLeases: number;
  tasksBlocked: string[];
  resourcesReleased: number;
  /** Tasks found RUNNING with no active lease — crash residue. */
  orphanedRunningTasks: string[];
  /** Resource leases held by tasks that are neither running nor leased. */
  orphanedResourceLeases: number;
}

export function reconcileStaleLeases(
  store: Store,
  engine: StateEngine,
  resources: ResourceManager,
  now: Date,
): ReconcileResult {
  const result: ReconcileResult = {
    staleLeases: 0,
    tasksBlocked: [],
    resourcesReleased: 0,
    orphanedRunningTasks: [],
    orphanedResourceLeases: 0,
  };

  // 1. Expired worker leases. One transaction each, so a crash cannot land
  //    between closing the lease and blocking the task.
  for (const lease of store.listActiveWorkerLeases()) {
    if (new Date(lease.expiresAt).getTime() > now.getTime()) continue;

    store.transaction(() => {
      store.closeWorkerLease(lease.id, 'STALE');
      store.setWorkerStatus(lease.workerId, 'IDLE');
      result.resourcesReleased += resources.releaseAllForTask(lease.taskId);

      const task = store.getTask(lease.taskId);
      if (!task) return;

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
          payload: { cause: 'worker lease expired without a report', leaseId: lease.id },
        });
        if (applied.ok) result.tasksBlocked.push(task.id);
      }
    });
    result.staleLeases += 1;
  }

  // 2. Tasks left RUNNING with no active lease. These cannot be found by
  //    walking leases, which is exactly why they used to be lost.
  for (const task of store.listRunningTasksWithoutActiveLease()) {
    const applied = engine.apply({
      taskId: task.id,
      event: 'INFRA_FAILURE',
      actor: 'reconciler',
      payload: { cause: 'task is RUNNING with no active worker lease' },
    });
    if (applied.ok) {
      result.orphanedRunningTasks.push(task.id);
      if (!result.tasksBlocked.includes(task.id)) result.tasksBlocked.push(task.id);
    }
  }

  // 3. Scarce slots held by nobody. A resource lease outliving its task's run
  //    would block every other task that needs it, indefinitely.
  for (const lease of store.listOrphanedResourceLeases()) {
    store.transaction(() => {
      store.closeResourceLease(lease.id, 'STALE');
      store.appendEvent({
        taskId: lease.taskId,
        eventType: 'RESOURCE_LEASE_ORPHANED',
        actor: 'reconciler',
        payload: { resource: lease.resourceName, leaseId: lease.id },
      });
    });
    result.orphanedResourceLeases += 1;
    result.resourcesReleased += 1;
  }

  return result;
}
