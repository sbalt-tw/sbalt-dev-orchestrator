/**
 * Regression tests for the findings raised in the Phase-0 closure review.
 *
 * Each block names the hole it closes. They are grouped here rather than spread
 * across the feature suites so the next reviewer can see, in one place, which
 * escapes were found and what now prevents them.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { Orchestrator } from '../src/orchestrator.js';
import {
  addWorkers,
  baseReport,
  cleanupTempDirs,
  FakeClock,
  makeHarness,
  testPolicy,
  tmpDbPath,
  SHA_A,
  SHA_BASE,
} from './helpers.js';
import { policySchema } from '../src/policy/schema.js';
import { assertTaskState } from '../src/state/store.js';

afterAll(cleanupTempDirs);

describe('accepted reports always move the task', () => {
  it('rejects a COMPLETED report with no PR on a task that owes one', () => {
    const h = makeHarness();
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'owes a PR',
      taskType: 'IMPLEMENTATION',
      requiresPr: true,
    });
    h.orch.tick();
    const lease = h.orch.store.getActiveWorkerLeaseForTask(task.id);

    const result = h.orch.submitReport({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: lease?.workerId ?? 'x' }),
      status: 'COMPLETED',
    });

    expect(result.accepted).toBe(false);
    // The worker still holds the task, so ordinary lease reconciliation
    // remains able to recover it.
    expect(h.orch.store.getActiveWorkerLeaseForTask(task.id)).not.toBeNull();
    h.orch.close();
  });

  it('rejects a BLOCKED report that says nothing about what blocks it', () => {
    const h = makeHarness();
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'vague block',
      taskType: 'DOCS',
      requiresPr: false,
    });
    h.orch.tick();
    const lease = h.orch.store.getActiveWorkerLeaseForTask(task.id);

    const result = h.orch.submitReport({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: lease?.workerId ?? 'x' }),
      status: 'BLOCKED',
    });

    expect(result.accepted).toBe(false);
    h.orch.close();
  });

  it('never leaves a task RUNNING with its lease released', () => {
    const h = makeHarness();
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'must not strand',
      taskType: 'DOCS',
      requiresPr: false,
    });
    h.orch.tick();
    const lease = h.orch.store.getActiveWorkerLeaseForTask(task.id);

    // A report that carries no PR, no CI, no review and no decision.
    const result = h.orch.submitReport({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: lease?.workerId ?? 'x' }),
      status: 'NEEDS_REVIEW',
    });

    expect(result.accepted).toBe(true);
    const after = h.orch.store.requireTask(task.id);
    expect(after.state).not.toBe('RUNNING');
    expect(after.state).toBe('BLOCKED_INFRA');
    h.orch.close();
  });

  it('treats a TASK-kind failure as rework, not an infrastructure block', () => {
    const h = makeHarness();
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'work failed',
      taskType: 'IMPLEMENTATION',
    });
    h.orch.tick();
    const lease = h.orch.store.getActiveWorkerLeaseForTask(task.id);

    h.orch.submitReport({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: lease?.workerId ?? 'x' }),
      status: 'FAILED',
      error: { kind: 'TASK', message: 'tests did not pass' },
    });

    expect(h.orch.store.requireTask(task.id).state).toBe('REVIEW_FIX');
    h.orch.close();
  });
});

describe('architectureDecisionRequired is honoured', () => {
  it('does not let a flagged architecture change complete without a decision', () => {
    const h = makeHarness();
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'architecture change',
      taskType: 'DOCS',
      requiresPr: false,
    });
    h.orch.tick();
    const lease = h.orch.store.getActiveWorkerLeaseForTask(task.id);

    h.orch.submitReport({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: lease?.workerId ?? 'x' }),
      status: 'COMPLETED',
      architectureDecisionRequired: true,
    });

    expect(h.orch.store.requireTask(task.id).state).toBe('FOUNDER_DECISION');
    const decisions = h.orch.store.listFounderDecisions({ taskId: task.id });
    expect(decisions.some((d) => d.category === 'architecture_change' && d.state === 'REQUIRED')).toBe(true);
    h.orch.close();
  });
});

describe('state vocabulary cannot be escaped', () => {
  it('refuses an unknown state at the application boundary', () => {
    expect(() => assertTaskState('ALMOST_DONE')).toThrow();
  });

  it('refuses an unknown state at the database boundary', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 't', taskType: 'DOCS' });
    // Bypass the store entirely; the CHECK constraint still refuses.
    expect(() =>
      h.orch.store.db.prepare('UPDATE tasks SET state = ? WHERE id = ?').run('NONSENSE', task.id),
    ).toThrow();
    h.orch.close();
  });

  it('refuses an unknown initial state', () => {
    const h = makeHarness();
    expect(() =>
      h.orch.store.createTask({
        laneId: h.laneId,
        title: 't',
        taskType: 'DOCS',
        initialState: 'NOT_A_STATE' as never,
      }),
    ).toThrow();
    h.orch.close();
  });
});

describe('Phase-0 gates are not configurable', () => {
  it('refuses a policy that opens the merge gate', () => {
    expect(() => policySchema.parse({ merge: { default: 'allowed' } })).toThrow();
  });

  it('refuses a policy that opens the remote-write gates', () => {
    expect(() => policySchema.parse({ remoteWrites: { production: 'allowed' } })).toThrow();
    expect(() => policySchema.parse({ remoteWrites: { staging: 'allowed' } })).toThrow();
  });

  it('refuses a policy that turns off the destructive-operation gate', () => {
    expect(() => policySchema.parse({ destructiveOperations: { founderRequired: false } })).toThrow();
  });

  it('refuses a gated resource with no authorising category', () => {
    expect(() =>
      policySchema.parse({
        resources: [{ name: 'custom-gated', capacity: 1, founderAuthorizationRequired: true }],
      }),
    ).toThrow();
  });

  it('refuses to leave production-write ungated', () => {
    expect(() =>
      policySchema.parse({
        resources: [{ name: 'production-write', capacity: 1, founderAuthorizationRequired: false }],
      }),
    ).toThrow();
  });
});

describe('dependencies are re-checked at dispatch', () => {
  it('holds a READY task whose dependency appeared after it became ready', () => {
    const h = makeHarness({ policy: testPolicy({ workers: { maxConcurrent: 2, leaseTtlMs: 60_000 } }) });
    addWorkers(h, 2);
    const upstream = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'upstream',
      taskType: 'DOCS',
      requiresPr: false,
      initialState: 'QUEUED',
    });
    const downstream = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'downstream',
      taskType: 'DOCS',
      requiresPr: false,
      initialState: 'READY',
    });

    // The dependency is added after the task is already READY.
    h.orch.store.addDependencyRow(downstream.id, upstream.id, 'DONE');

    h.orch.tick();

    expect(h.orch.store.requireTask(downstream.id).state).toBe('WAITING_DEPENDENCY');
    h.orch.close();
  });
});

describe('crash residue is always recoverable', () => {
  it('blocks a task found RUNNING with no active lease', () => {
    const h = makeHarness();
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'orphaned by a crash',
      taskType: 'DOCS',
      requiresPr: false,
    });
    h.orch.tick();
    const lease = h.orch.store.getActiveWorkerLeaseForTask(task.id);
    expect(lease).not.toBeNull();

    // Simulate a crash landing between closing the lease and transitioning.
    if (lease) h.orch.store.closeWorkerLease(lease.id, 'STALE');
    expect(h.orch.store.requireTask(task.id).state).toBe('RUNNING');

    const result = h.orch.tick();

    expect(result.reconcile.orphanedRunningTasks).toContain(task.id);
    expect(h.orch.store.requireTask(task.id).state).toBe('BLOCKED_INFRA');
    h.orch.close();
  });

  it('returns a scarce slot held by a task that is no longer running', () => {
    const h = makeHarness({
      policy: testPolicy({
        workers: { maxConcurrent: 2, leaseTtlMs: 60_000 },
        resources: [{ name: 'codex', capacity: 1 }],
      }),
    });
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'held codex',
      taskType: 'DOCS',
      requiresPr: false,
      requiredResources: ['codex'],
    });
    h.orch.tick();
    expect(h.orch.resources.available('codex')).toBe(0);

    // Crash residue: lease gone, task pushed out of RUNNING, resource still held.
    const lease = h.orch.store.getActiveWorkerLeaseForTask(task.id);
    if (lease) h.orch.store.closeWorkerLease(lease.id, 'STALE');
    h.orch.store.setTaskState(task.id, 'BLOCKED_INFRA');

    const result = h.orch.tick();

    expect(result.reconcile.orphanedResourceLeases).toBeGreaterThan(0);
    expect(h.orch.resources.available('codex')).toBe(1);
    h.orch.close();
  });

  it('recovers to where the work was interrupted, not to a caller-chosen state', () => {
    const dbPath = tmpDbPath();
    const policy = testPolicy({ workers: { maxConcurrent: 2, leaseTtlMs: 60_000 } });
    const h = makeHarness({ policy, dbPath, clock: new FakeClock() });
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'interrupted during review',
      taskType: 'IMPLEMENTATION',
      initialState: 'WAITING_REVIEW',
    });
    h.orch.engine.apply({ taskId: task.id, event: 'INFRA_FAILURE', actor: 'test' });
    expect(h.orch.store.requireTask(task.id).state).toBe('BLOCKED_INFRA');

    // The caller asks for QUEUED; the engine returns it to WAITING_REVIEW.
    const wrong = h.orch.engine.apply({
      taskId: task.id,
      event: 'RECOVERED',
      actor: 'test',
      target: 'QUEUED',
    });
    expect(wrong.ok).toBe(false);

    const right = h.orch.engine.apply({ taskId: task.id, event: 'RECOVERED', actor: 'test' });
    expect(right.ok).toBe(true);
    expect(h.orch.store.requireTask(task.id).state).toBe('WAITING_REVIEW');
    h.orch.close();
  });
});

describe('review budget escalation is actionable', () => {
  it('creates a decision the Founder can actually resolve', () => {
    const h = makeHarness({
      policy: testPolicy({ review: { standardMaxRounds: 1, highRiskMaxRounds: 1 } }),
    });
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'budget exhausted',
      taskType: 'IMPLEMENTATION',
      initialState: 'WAITING_REVIEW',
    });
    h.orch.store.updateTaskFields(task.id, { prNumber: 1, prBaseSha: SHA_BASE, prHeadSha: SHA_A });

    h.orch.submitReport({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: 'wk_reviewer' }),
      review: {
        reviewer: 'codex',
        round: 1,
        baseSha: SHA_BASE,
        headSha: SHA_A,
        blocker: 0,
        high: 1,
        medium: 0,
        low: 0,
        status: 'COMPLETED_VERDICT',
      },
    });

    expect(h.orch.store.requireTask(task.id).state).toBe('FOUNDER_DECISION');
    const open = h.orch.store
      .listFounderDecisions({ taskId: task.id })
      .filter((d) => d.category === 'review_budget_extension' && d.state === 'REQUIRED');
    expect(open).toHaveLength(1);

    const first = open[0];
    expect(first).toBeDefined();
    if (first) {
      h.orch.resolveFounderDecision(first.id, 'one more round');
      expect(h.orch.store.requireTask(task.id).state).toBe('REVIEW_FIX');
    }
    h.orch.close();
  });
});

describe('durability of a dispatch', () => {
  it('leaves no partial state when a dispatch cannot complete', () => {
    const h = makeHarness({
      policy: testPolicy({
        workers: { maxConcurrent: 2, leaseTtlMs: 60_000 },
        resources: [{ name: 'codex', capacity: 1 }],
      }),
    });
    addWorkers(h, 1);
    h.orch.store.createTask({
      laneId: h.laneId,
      title: 'wants codex and something undeclared',
      taskType: 'DOCS',
      requiresPr: false,
      requiredResources: ['codex', 'undeclared'],
    });

    const result = h.orch.tick();

    expect(result.dispatched).toHaveLength(0);
    expect(h.orch.resources.available('codex')).toBe(1);
    expect(h.orch.store.listActiveWorkerLeases()).toHaveLength(0);
    expect(h.orch.store.listWorkers('IDLE')).toHaveLength(1);
    h.orch.close();
  });

  it('keeps state consistent across a restart mid-dispatch', () => {
    const dbPath = tmpDbPath();
    const policy = testPolicy({ workers: { maxConcurrent: 2, leaseTtlMs: 60_000 } });
    const h = makeHarness({ policy, dbPath, clock: new FakeClock() });
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'consistent',
      taskType: 'DOCS',
      requiresPr: false,
    });
    addWorkers(h, 1);
    h.orch.tick();
    h.orch.close();

    const restarted = new Orchestrator({ dbPath, policy, clock: new FakeClock() });
    restarted.init();
    // Exactly one lease, one BUSY worker, one RUNNING task: no torn dispatch.
    expect(restarted.store.listActiveWorkerLeases()).toHaveLength(1);
    expect(restarted.store.listWorkers('BUSY')).toHaveLength(1);
    expect(restarted.store.requireTask(task.id).state).toBe('RUNNING');
    restarted.close();
  });
});
