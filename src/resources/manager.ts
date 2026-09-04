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

import type {
  FounderDecisionCategory,
  ResourceDefinition,
  ResourceLease,
  Task,
} from '../domain/entities.js';
import type { Store } from '../state/store.js';
import type { Policy } from '../policy/schema.js';
import { REMOTE_WRITE_RESOURCE_CATEGORIES } from '../policy/schema.js';
import { checkGate } from '../policy/founderGate.js';

export type AcquireFailureReason =
  | 'UNKNOWN_RESOURCE'
  | 'AT_CAPACITY'
  | 'FOUNDER_AUTHORIZATION_REQUIRED'
  | 'MISCONFIGURED_RESOURCE'
  | 'ALREADY_HELD';

export type AcquireResult =
  | { ok: true; lease: ResourceLease; alreadyHeld: boolean }
  | { ok: false; reason: AcquireFailureReason; detail: string };

/**
 * The category that authorises a resource.
 *
 * Two names are gated by identity regardless of what the definition says, so a
 * missing flag on `production-write` cannot quietly remove the production gate.
 * Anything else uses its declared category.
 */
function gateCategoryFor(def: ResourceDefinition): FounderDecisionCategory | null {
  const forced = REMOTE_WRITE_RESOURCE_CATEGORIES[def.name];
  if (forced) return forced;
  return def.founderCategory;
}

export class ResourceManager {
  constructor(
    private readonly store: Store,
    private readonly policy: Policy,
  ) {}

  /**
   * Load resource definitions from policy into durable state.
   *
   * The two remote-write names are forced to their category here as well as in
   * the parser, so a database seeded by an older build cannot end up with an
   * ungated production-write row.
   */
  syncDefinitions(): void {
    for (const def of this.policy.resources) {
      const forced = REMOTE_WRITE_RESOURCE_CATEGORIES[def.name];
      this.store.upsertResource({
        name: def.name,
        capacity: def.capacity,
        founderAuthorizationRequired: forced ? true : def.founderAuthorizationRequired,
        founderCategory: forced ?? def.founderCategory,
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

    const category = gateCategoryFor(def);
    const gated = def.founderAuthorizationRequired || REMOTE_WRITE_RESOURCE_CATEGORIES[def.name] !== undefined;
    if (gated) {
      if (!category) {
        // Fail closed: a resource that claims to need authorisation but names
        // no category cannot be checked, so it is refused rather than leased.
        return {
          ok: false,
          reason: 'MISCONFIGURED_RESOURCE',
          detail: `${def.name} is founder-gated but declares no authorising category`,
        };
      }
      const gate = checkGate(this.store, this.policy, input.task, category);
      if (gate.required && !gate.satisfied) {
        return {
          ok: false,
          reason: 'FOUNDER_AUTHORIZATION_REQUIRED',
          detail: `${def.name}: ${gate.reason}`,
        };
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
