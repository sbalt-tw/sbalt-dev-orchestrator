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
  for (const candidate of store.listActiveWorkerLeases()) {
    if (new Date(candidate.expiresAt).getTime() > now.getTime()) continue;

    const acted = store.immediateTransaction(() => {
      // Re-read inside the transaction. The list was taken outside it, and a
      // heartbeat between the two would otherwise let reconciliation kill a
      // lease that had just been renewed.
      const lease = store.getActiveWorkerLeaseForTask(candidate.taskId);
      if (!lease || lease.id !== candidate.id) return false;
      if (new Date(lease.expiresAt).getTime() > now.getTime()) return false;

      store.closeWorkerLease(lease.id, 'STALE');
      store.setWorkerStatus(lease.workerId, 'IDLE');
      result.resourcesReleased += resources.releaseAllForTask(lease.taskId);

      const task = store.getTask(lease.taskId);
      if (!task) return true;

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
      return true;
    });
    if (acted) result.staleLeases += 1;
  }

  // 2. Tasks left RUNNING with no active lease. These cannot be found by
  //    walking leases, which is exactly why they used to be lost.
  for (const candidate of store.listRunningTasksWithoutActiveLease()) {
    const blocked = store.immediateTransaction(() => {
      // Re-check: a dispatch committing between the read and here would have
      // given the task a lease, and blocking it would disrupt healthy work.
      const task = store.getTask(candidate.id);
      if (!task || task.state !== 'RUNNING') return false;
      if (store.getActiveWorkerLeaseForTask(task.id)) return false;
      return engine.apply({
        taskId: task.id,
        event: 'INFRA_FAILURE',
        actor: 'reconciler',
        payload: { cause: 'task is RUNNING with no active worker lease' },
      }).ok;
    });
    if (blocked) {
      result.orphanedRunningTasks.push(candidate.id);
      if (!result.tasksBlocked.includes(candidate.id)) result.tasksBlocked.push(candidate.id);
    }
  }

  // 3. Scarce slots held by nobody. A resource lease outliving its task's run
  //    would block every other task that needs it, indefinitely.
  for (const candidate of store.listOrphanedResourceLeases()) {
    const released = store.immediateTransaction(() => {
      // Re-check inside the transaction so a dispatch that just claimed this
      // slot is not robbed of it.
      const task = store.getTask(candidate.taskId);
      if (!task || task.state === 'RUNNING') return false;
      if (store.getActiveWorkerLeaseForTask(candidate.taskId)) return false;
      const held = store
        .listResourceLeasesForTask(candidate.taskId)
        .find((l) => l.id === candidate.id);
      if (!held) return false;

      store.closeResourceLease(candidate.id, 'STALE');
      store.appendEvent({
        taskId: candidate.taskId,
        eventType: 'RESOURCE_LEASE_ORPHANED',
        actor: 'reconciler',
        payload: { resource: candidate.resourceName, leaseId: candidate.id },
      });
      return true;
    });
    if (released) {
      result.orphanedResourceLeases += 1;
      result.resourcesReleased += 1;
    }
  }

  return result;
}
