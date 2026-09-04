/**
 * Logical resource scheduler.
 *
 * Scarce things the workflow contends for — a single reviewer slot, a heavy
 * docker runner, the right to write to a remote environment — are modelled as
 * named resources with a capacity and leases against them. The core scheduler
 * reasons only about ResourceLease.
 *
 * Deliberately not modelled here: how a resource is enforced in the outside
 * world. The current SBALT workflow guards its reviewer with a lock file at
 * /tmp/sbalt-codex.lock, but that is one project's implementation detail. A
 * future project adapter can map the logical `codex` resource onto that lock;
 * baking the path in here would make the lock the architecture.
 *
 * Resource capacity is independent of worker count. Ten workers and one codex
 * slot means nine workers do something else.
 */

import type { ResourceDefinition, ResourceLease, Task } from '../domain/entities.js';
import type { Store } from '../state/store.js';
import type { Policy } from '../policy/schema.js';
import { checkGate } from '../policy/founderGate.js';

export type AcquireFailureReason =
  | 'UNKNOWN_RESOURCE'
  | 'AT_CAPACITY'
  | 'FOUNDER_AUTHORIZATION_REQUIRED'
  | 'ALREADY_HELD';

export type AcquireResult =
  | { ok: true; lease: ResourceLease; alreadyHeld: boolean }
  | { ok: false; reason: AcquireFailureReason; detail: string };

/** Map a resource name onto the Founder decision category that authorises it. */
function gateCategoryFor(resourceName: string): 'staging_write' | 'production_write' | null {
  if (resourceName === 'staging-write') return 'staging_write';
  if (resourceName === 'production-write') return 'production_write';
  return null;
}

export class ResourceManager {
  constructor(
    private readonly store: Store,
    private readonly policy: Policy,
  ) {}

  /** Load resource definitions from policy into durable state. */
  syncDefinitions(): void {
    for (const def of this.policy.resources) {
      this.store.upsertResource({
        name: def.name,
        capacity: def.capacity,
        founderAuthorizationRequired: def.founderAuthorizationRequired,
      });
    }
  }

  definitions(): ResourceDefinition[] {
    return this.store.listResources();
  }

  available(resourceName: string): number {
    const def = this.store.getResource(resourceName);
    if (!def) return 0;
    return Math.max(0, def.capacity - this.store.countActiveResourceLeases(resourceName));
  }

  /**
   * Try to take a lease. Returns a structured failure rather than throwing, so
   * the scheduler can simply leave the task READY and try again next tick.
   */
  acquire(input: {
    resourceName: string;
    task: Task;
    workerId?: string | null;
    ttlMs?: number | null;
  }): AcquireResult {
    const def = this.store.getResource(input.resourceName);
    if (!def) {
      return {
        ok: false,
        reason: 'UNKNOWN_RESOURCE',
        detail: `resource '${input.resourceName}' is not defined in policy`,
      };
    }

    const held = this.store
      .listResourceLeasesForTask(input.task.id)
      .find((l) => l.resourceName === input.resourceName);
    if (held) {
      return { ok: true, lease: held, alreadyHeld: true };
    }

    if (def.founderAuthorizationRequired) {
      const category = gateCategoryFor(def.name);
      if (category) {
        const gate = checkGate(this.store, this.policy, input.task, category);
        if (gate.required && !gate.satisfied) {
          return {
            ok: false,
            reason: 'FOUNDER_AUTHORIZATION_REQUIRED',
            detail: `${def.name}: ${gate.reason}`,
          };
        }
      }
    }

    if (this.store.countActiveResourceLeases(def.name) >= def.capacity) {
      return {
        ok: false,
        reason: 'AT_CAPACITY',
        detail: `${def.name} at capacity ${def.capacity}`,
      };
    }

    const lease = this.store.createResourceLease({
      resourceName: def.name,
      taskId: input.task.id,
      workerId: input.workerId ?? null,
      ttlMs: input.ttlMs ?? null,
    });
    return { ok: true, lease, alreadyHeld: false };
  }

  releaseAllForTask(taskId: string): number {
    const leases = this.store.listResourceLeasesForTask(taskId);
    for (const lease of leases) {
      this.store.closeResourceLease(lease.id, 'RELEASED');
    }
    return leases.length;
  }

  release(leaseId: string): void {
    this.store.closeResourceLease(leaseId, 'RELEASED');
  }
}
