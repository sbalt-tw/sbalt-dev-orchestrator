import { afterAll, describe, expect, it } from 'vitest';
import { addWorkers, cleanupTempDirs, makeHarness, testPolicy } from './helpers.js';

afterAll(cleanupTempDirs);

describe('lane active-PR policy', () => {
  it('will not open a second implementation PR in a lane limited to one', () => {
    const h = makeHarness({
      policy: testPolicy({ workers: { maxConcurrent: 4, leaseTtlMs: 60_000 } }),
      maxPrs: 1,
    });
    addWorkers(h, 3);
    const first = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'first PR',
      taskType: 'IMPLEMENTATION',
      priority: 10,
    });
    const second = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'second PR',
      taskType: 'IMPLEMENTATION',
      priority: 5,
    });

    const result = h.orch.tick();

    expect(result.dispatched).toHaveLength(1);
    expect(result.dispatched[0]?.taskId).toBe(first.id);
    expect(h.orch.store.requireTask(second.id).state).toBe('READY');
    expect(
      result.skipped.some((s) => s.taskId === second.id && s.reason.includes('active implementation PR')),
    ).toBe(true);
    h.orch.close();
  });

  it('records why the second task was held so the block is explainable', () => {
    const h = makeHarness({ maxPrs: 1 });
    addWorkers(h, 2);
    h.orch.store.createTask({ laneId: h.laneId, title: 'first', taskType: 'IMPLEMENTATION', priority: 10 });
    const second = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'second',
      taskType: 'IMPLEMENTATION',
      priority: 1,
    });

    h.orch.tick();

    const limitEvent = h.orch.store
      .listEvents(second.id)
      .find((e) => e.eventType === 'LANE_PR_LIMIT_REACHED');
    expect(limitEvent).toBeDefined();
    h.orch.close();
  });

  it('allows a higher limit to run two implementation PRs at once', () => {
    const h = makeHarness({
      policy: testPolicy({ workers: { maxConcurrent: 4, leaseTtlMs: 60_000 } }),
      maxPrs: 2,
    });
    addWorkers(h, 3);
    h.orch.store.createTask({ laneId: h.laneId, title: 'first', taskType: 'IMPLEMENTATION', priority: 10 });
    h.orch.store.createTask({ laneId: h.laneId, title: 'second', taskType: 'IMPLEMENTATION', priority: 5 });

    expect(h.orch.tick().dispatched).toHaveLength(2);
    h.orch.close();
  });

  it('does not count a non-PR docs task against the lane PR limit', () => {
    const h = makeHarness({
      policy: testPolicy({ workers: { maxConcurrent: 4, leaseTtlMs: 60_000 } }),
      maxPrs: 1,
    });
    addWorkers(h, 3);
    h.orch.store.createTask({ laneId: h.laneId, title: 'impl', taskType: 'IMPLEMENTATION', priority: 10 });
    h.orch.store.createTask({
      laneId: h.laneId,
      title: 'docs',
      taskType: 'DOCS',
      requiresPr: false,
      priority: 9,
    });

    expect(h.orch.tick().dispatched).toHaveLength(2);
    h.orch.close();
  });

  it('skips a paused lane', () => {
    const h = makeHarness();
    addWorkers(h, 1);
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 'paused', taskType: 'DOCS', requiresPr: false });
    h.orch.store.setLaneStatus(h.laneId, 'PAUSED');

    const result = h.orch.tick();

    expect(result.dispatched).toHaveLength(0);
    expect(result.skipped.some((s) => s.taskId === task.id && s.reason.includes('PAUSED'))).toBe(true);
    h.orch.close();
  });
});
