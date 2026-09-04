import { afterAll, describe, expect, it } from 'vitest';
import { addWorkers, cleanupTempDirs, makeHarness, testPolicy } from './helpers.js';

afterAll(cleanupTempDirs);

describe('resource scheduler', () => {
  it('grants only one lease when codex capacity is 1', () => {
    const h = makeHarness({
      policy: testPolicy({
        workers: { maxConcurrent: 5, leaseTtlMs: 60_000 },
        resources: [{ name: 'codex', capacity: 1 }],
      }),
    });
    addWorkers(h, 2);
    const t1 = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'needs codex first',
      taskType: 'DOCS',
      requiresPr: false,
      priority: 10,
      requiredResources: ['codex'],
    });
    const t2 = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'needs codex too',
      taskType: 'DOCS',
      requiresPr: false,
      priority: 5,
      requiredResources: ['codex'],
    });

    const result = h.orch.tick();

    expect(result.dispatched).toHaveLength(1);
    expect(result.dispatched[0]?.taskId).toBe(t1.id);
    expect(h.orch.store.requireTask(t2.id).state).toBe('READY');
    expect(result.skipped.some((s) => s.taskId === t2.id && s.reason.includes('AT_CAPACITY'))).toBe(true);
    expect(h.orch.resources.available('codex')).toBe(0);
    h.orch.close();
  });

  it('honours a configurable capacity greater than one', () => {
    const h = makeHarness({
      policy: testPolicy({
        workers: { maxConcurrent: 5, leaseTtlMs: 60_000 },
        resources: [{ name: 'docker-heavy', capacity: 2 }],
      }),
    });
    addWorkers(h, 4);
    for (let i = 0; i < 3; i += 1) {
      h.orch.store.createTask({
        laneId: h.laneId,
        title: `docker task ${i}`,
        taskType: 'DOCS',
        requiresPr: false,
        priority: 10 - i,
        requiredResources: ['docker-heavy'],
      });
    }

    const result = h.orch.tick();

    expect(result.dispatched).toHaveLength(2);
    expect(h.orch.resources.available('docker-heavy')).toBe(0);
    h.orch.close();
  });

  it('releases a resource when the holding task reports back', () => {
    const h = makeHarness({
      policy: testPolicy({
        workers: { maxConcurrent: 2, leaseTtlMs: 60_000 },
        resources: [{ name: 'codex', capacity: 1 }],
      }),
    });
    addWorkers(h, 2);
    const t1 = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'holder',
      taskType: 'DOCS',
      requiresPr: false,
      priority: 10,
      requiredResources: ['codex'],
    });
    h.orch.store.createTask({
      laneId: h.laneId,
      title: 'waiter',
      taskType: 'DOCS',
      requiresPr: false,
      priority: 5,
      requiredResources: ['codex'],
    });

    h.orch.tick();
    expect(h.orch.resources.available('codex')).toBe(0);

    const lease = h.orch.store.getActiveWorkerLeaseForTask(t1.id);
    h.orch.submitReport({
      reportVersion: 1,
      taskId: t1.id,
      laneId: h.laneId,
      workerId: lease?.workerId,
      status: 'COMPLETED',
      filesChanged: [],
      architectureDecisionRequired: false,
      recommendedNextAction: 'NOOP',
    });

    expect(h.orch.resources.available('codex')).toBe(1);
    expect(h.orch.tick().dispatched).toHaveLength(1);
    h.orch.close();
  });

  it('refuses an unknown resource rather than inventing capacity', () => {
    const h = makeHarness();
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'asks for a resource nobody declared',
      taskType: 'DOCS',
      requiresPr: false,
      requiredResources: ['nonexistent-resource'],
    });

    const result = h.orch.tick();

    expect(result.dispatched).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason.includes('UNKNOWN_RESOURCE'))).toBe(true);
    expect(h.orch.store.requireTask(task.id).state).toBe('READY');
    h.orch.close();
  });

  it('rolls back a partial acquisition so a scarce slot is not stranded', () => {
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
    // codex must have been handed back, not left held by a task that never ran.
    expect(h.orch.resources.available('codex')).toBe(1);
    h.orch.close();
  });
});
