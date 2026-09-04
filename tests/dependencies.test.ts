import { afterAll, describe, expect, it } from 'vitest';
import { addWorkers, cleanupTempDirs, makeHarness } from './helpers.js';
import { addDependency, DependencyCycleError, dependenciesSatisfied } from '../src/scheduler/dependencies.js';

afterAll(cleanupTempDirs);

describe('dependency graph', () => {
  it('holds B while A is unfinished, then releases it when A is DONE', () => {
    const h = makeHarness();
    addWorkers(h, 2);
    const a = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'A',
      taskType: 'DOCS',
      requiresPr: false,
    });
    const b = h.orch.store.createTask({ laneId: h.laneId, title: 'B', taskType: 'DOCS', requiresPr: false });
    addDependency(h.orch.store, b.id, a.id, 'DONE');

    h.orch.tick();
    expect(h.orch.store.requireTask(a.id).state).toBe('RUNNING');
    expect(h.orch.store.requireTask(b.id).state).toBe('WAITING_DEPENDENCY');

    // Finish A through the normal path.
    const lease = h.orch.store.getActiveWorkerLeaseForTask(a.id);
    expect(lease).not.toBeNull();
    h.orch.submitReport({
      reportVersion: 1,
      taskId: a.id,
      laneId: h.laneId,
      workerId: lease?.workerId,
      status: 'COMPLETED',
      filesChanged: [],
      architectureDecisionRequired: false,
      recommendedNextAction: 'NOOP',
    });
    expect(h.orch.store.requireTask(a.id).state).toBe('DONE');
    expect(dependenciesSatisfied(h.orch.store, b.id)).toBe(true);

    h.orch.tick();
    expect(h.orch.store.requireTask(b.id).state).toBe('RUNNING');
    h.orch.close();
  });

  it('lets an unrelated lane keep moving while a dependency waits', () => {
    const h = makeHarness();
    addWorkers(h, 2);
    const otherLane = h.orch.store.createLane({ projectId: h.projectId, name: 'lane-2' });

    const a = h.orch.store.createTask({ laneId: h.laneId, title: 'A', taskType: 'DOCS', requiresPr: false });
    const b = h.orch.store.createTask({ laneId: h.laneId, title: 'B', taskType: 'DOCS', requiresPr: false });
    const c = h.orch.store.createTask({
      laneId: otherLane.id,
      title: 'C independent',
      taskType: 'DOCS',
      requiresPr: false,
    });
    addDependency(h.orch.store, b.id, a.id, 'DONE');

    h.orch.tick();

    expect(h.orch.store.requireTask(b.id).state).toBe('WAITING_DEPENDENCY');
    expect(h.orch.store.requireTask(a.id).state).toBe('RUNNING');
    expect(h.orch.store.requireTask(c.id).state).toBe('RUNNING');
    h.orch.close();
  });

  it('rejects a self dependency', () => {
    const h = makeHarness();
    const a = h.orch.store.createTask({ laneId: h.laneId, title: 'A', taskType: 'DOCS' });
    expect(() => addDependency(h.orch.store, a.id, a.id)).toThrow(DependencyCycleError);
    h.orch.close();
  });

  it('rejects a direct cycle', () => {
    const h = makeHarness();
    const a = h.orch.store.createTask({ laneId: h.laneId, title: 'A', taskType: 'DOCS' });
    const b = h.orch.store.createTask({ laneId: h.laneId, title: 'B', taskType: 'DOCS' });
    addDependency(h.orch.store, b.id, a.id);
    expect(() => addDependency(h.orch.store, a.id, b.id)).toThrow(DependencyCycleError);
    expect(h.orch.store.listDependencies(a.id)).toHaveLength(0);
    h.orch.close();
  });

  it('rejects a transitive cycle', () => {
    const h = makeHarness();
    const a = h.orch.store.createTask({ laneId: h.laneId, title: 'A', taskType: 'DOCS' });
    const b = h.orch.store.createTask({ laneId: h.laneId, title: 'B', taskType: 'DOCS' });
    const c = h.orch.store.createTask({ laneId: h.laneId, title: 'C', taskType: 'DOCS' });
    addDependency(h.orch.store, b.id, a.id); // B depends on A
    addDependency(h.orch.store, c.id, b.id); // C depends on B

    // A depending on C would close the loop A -> C -> B -> A.
    expect(() => addDependency(h.orch.store, a.id, c.id)).toThrow(DependencyCycleError);
    expect(h.orch.store.listDependencies(a.id)).toHaveLength(0);
    h.orch.close();
  });

  it('honours a required state other than DONE', () => {
    const h = makeHarness();
    const a = h.orch.store.createTask({ laneId: h.laneId, title: 'A', taskType: 'IMPLEMENTATION' });
    const b = h.orch.store.createTask({ laneId: h.laneId, title: 'B', taskType: 'IMPLEMENTATION' });
    addDependency(h.orch.store, b.id, a.id, 'READY_TO_MERGE');

    expect(dependenciesSatisfied(h.orch.store, b.id)).toBe(false);
    h.orch.store.setTaskState(a.id, 'READY_TO_MERGE');
    expect(dependenciesSatisfied(h.orch.store, b.id)).toBe(true);
    h.orch.close();
  });
});
