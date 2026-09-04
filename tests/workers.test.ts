import { afterAll, describe, expect, it } from 'vitest';
import { addWorkers, cleanupTempDirs, makeHarness, testPolicy } from './helpers.js';
import { CAPABILITIES } from '../src/workers/provider.js';

afterAll(cleanupTempDirs);

function makeTasks(h: ReturnType<typeof makeHarness>, n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    h.orch.store.createTask({
      laneId: h.laneId,
      title: `task ${i}`,
      taskType: 'DOCS',
      requiresPr: false,
      priority: n - i,
    }).id,
  );
}

describe('dynamic worker pool', () => {
  it('dispatches at most maxConcurrent=1 task per tick', () => {
    const h = makeHarness({ policy: testPolicy({ workers: { maxConcurrent: 1, leaseTtlMs: 60_000 } }) });
    addWorkers(h, 3);
    makeTasks(h, 3);

    const result = h.orch.tick();

    expect(result.dispatched).toHaveLength(1);
    expect(result.skipped.some((s) => s.reason.includes('concurrency ceiling'))).toBe(true);
    h.orch.close();
  });

  it('dispatches up to maxConcurrent=3 when workers and tasks allow', () => {
    const h = makeHarness({ policy: testPolicy({ workers: { maxConcurrent: 3, leaseTtlMs: 60_000 } }) });
    addWorkers(h, 3);
    makeTasks(h, 5);

    const result = h.orch.tick();

    expect(result.dispatched).toHaveLength(3);
    h.orch.close();
  });

  it('never hardcodes a worker count: raising the pool raises throughput', () => {
    const h = makeHarness({ policy: testPolicy({ workers: { maxConcurrent: 10, leaseTtlMs: 60_000 } }) });
    addWorkers(h, 2);
    makeTasks(h, 6);

    expect(h.orch.tick().dispatched).toHaveLength(2);

    // A worker added at runtime is picked up on the next tick with no restart
    // and no loss of task state.
    addWorkers(h, 3);
    expect(h.orch.tick().dispatched).toHaveLength(3);
    h.orch.close();
  });

  it('allows an idle worker to be removed without disturbing tasks', () => {
    const h = makeHarness();
    const [w1, w2] = addWorkers(h, 2);
    expect(w1).toBeDefined();
    expect(w2).toBeDefined();
    const tasks = makeTasks(h, 1);

    if (w2) h.orch.store.removeWorker(w2);
    expect(h.orch.store.listWorkers()).toHaveLength(1);

    const result = h.orch.tick();
    expect(result.dispatched).toHaveLength(1);
    expect(h.orch.store.requireTask(tasks[0] as string).state).toBe('RUNNING');
    h.orch.close();
  });

  it('will not dispatch to a worker lacking the required capability', () => {
    const h = makeHarness();
    h.orch.store.registerWorker({ provider: 'fake', capabilities: [CAPABILITIES.docs] });
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'needs deployment capability',
      taskType: 'DEPLOYMENT',
      requiresPr: false,
      requiredCapabilities: [CAPABILITIES.deployment],
    });

    const result = h.orch.tick();

    expect(result.dispatched).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason.includes('deployment'))).toBe(true);
    expect(h.orch.store.requireTask(task.id).state).toBe('READY');
    h.orch.close();
  });

  it('orders candidates by priority then age', () => {
    const h = makeHarness({ policy: testPolicy({ workers: { maxConcurrent: 1, leaseTtlMs: 60_000 } }) });
    addWorkers(h, 1);
    h.orch.store.createTask({ laneId: h.laneId, title: 'low', taskType: 'DOCS', requiresPr: false, priority: 1 });
    const high = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'high',
      taskType: 'DOCS',
      requiresPr: false,
      priority: 99,
    });

    const result = h.orch.tick();

    expect(result.dispatched[0]?.taskId).toBe(high.id);
    h.orch.close();
  });
});
