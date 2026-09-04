import { afterAll, describe, expect, it } from 'vitest';
import { makeHarness, cleanupTempDirs, addWorkers } from './helpers.js';
import { allowedTargets, isTerminal } from '../src/domain/states.js';

afterAll(cleanupTempDirs);

describe('state machine', () => {
  it('rejects an event that is not allowed from the current state', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'no jumping straight to merge',
      taskType: 'IMPLEMENTATION',
    });

    const result = h.orch.engine.apply({ taskId: task.id, event: 'MERGED', actor: 'test' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('not allowed from QUEUED');
    expect(h.orch.store.requireTask(task.id).state).toBe('QUEUED');
    h.orch.close();
  });

  it('persists a valid transition and records it in history', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'ready when nothing blocks it',
      taskType: 'IMPLEMENTATION',
    });

    const result = h.orch.engine.apply({
      taskId: task.id,
      event: 'DEPENDENCIES_SATISFIED',
      actor: 'test',
    });

    expect(result.ok).toBe(true);
    expect(h.orch.store.requireTask(task.id).state).toBe('READY');

    const history = h.orch.store.listEvents(task.id);
    const transition = history.find((e) => e.eventType === 'DEPENDENCIES_SATISFIED');
    expect(transition).toBeDefined();
    expect(transition?.fromState).toBe('QUEUED');
    expect(transition?.toState).toBe('READY');
    h.orch.close();
  });

  it('records a rejection in history so blocked work is explainable', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'rejected transitions are auditable',
      taskType: 'IMPLEMENTATION',
    });

    h.orch.engine.apply({ taskId: task.id, event: 'CI_PASSED', actor: 'test' });

    const rejected = h.orch.store.listEvents(task.id).find((e) => e.eventType === 'REJECTED:CI_PASSED');
    expect(rejected).toBeDefined();
    h.orch.close();
  });

  it('refuses to move a terminal task', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'terminal is terminal',
      taskType: 'DOCS',
      requiresPr: false,
      initialState: 'DONE',
    });

    const result = h.orch.engine.apply({
      taskId: task.id,
      event: 'DEPENDENCIES_SATISFIED',
      actor: 'test',
    });

    expect(result.ok).toBe(false);
    expect(isTerminal('DONE')).toBe(true);
    h.orch.close();
  });

  it('resolves a multi-target event from the decision, not from the caller', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'deterministic resolution',
      taskType: 'IMPLEMENTATION',
      initialState: 'FOUNDER_DECISION',
    });
    // More than one target is structurally allowed...
    expect(allowedTargets('FOUNDER_DECISION', 'FOUNDER_DECISION_RESOLVED').length).toBeGreaterThan(1);

    // ...but without a decision to read, nothing resolves.
    const noDecision = h.orch.engine.apply({
      taskId: task.id,
      event: 'FOUNDER_DECISION_RESOLVED',
      actor: 'test',
    });
    expect(noDecision.ok).toBe(false);
    if (!noDecision.ok) expect(noDecision.reason).toContain('payload.decisionId');

    const decision = h.orch.store.createFounderDecision({
      taskId: task.id,
      category: 'architecture_change',
      question: 'q',
      provenance: 'test',
    });
    h.orch.store.setFounderDecisionState(decision.id, 'RESOLVED', 'yes', 'READY', 'APPROVED');

    const resolved = h.orch.engine.apply({
      taskId: task.id,
      event: 'FOUNDER_DECISION_RESOLVED',
      actor: 'test',
      payload: { decisionId: decision.id },
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.to).toBe('READY');
    h.orch.close();
  });

  it('rejects a caller target that contradicts the decision', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'caller cannot override',
      taskType: 'IMPLEMENTATION',
      initialState: 'FOUNDER_DECISION',
    });
    const decision = h.orch.store.createFounderDecision({
      taskId: task.id,
      category: 'architecture_change',
      question: 'q',
      provenance: 'test',
    });
    // The Founder said READY; the caller asks for READY_TO_MERGE.
    h.orch.store.setFounderDecisionState(decision.id, 'RESOLVED', 'yes', 'READY', 'APPROVED');

    const result = h.orch.engine.apply({
      taskId: task.id,
      event: 'FOUNDER_DECISION_RESOLVED',
      actor: 'test',
      target: 'READY_TO_MERGE',
      payload: { decisionId: decision.id },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('contradicts');
    expect(h.orch.store.requireTask(task.id).state).toBe('FOUNDER_DECISION');
    h.orch.close();
  });

  it('will not let WORKER_COMPLETED finish a task that owes a PR', () => {
    const h = makeHarness();
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'PR is required',
      taskType: 'IMPLEMENTATION',
      requiresPr: true,
      initialState: 'READY',
    });
    h.orch.tick();
    expect(h.orch.store.requireTask(task.id).state).toBe('RUNNING');

    const result = h.orch.engine.apply({ taskId: task.id, event: 'WORKER_COMPLETED', actor: 'test' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('requires a PR');
    h.orch.close();
  });

  it('rejects WORKER_ASSIGNED without an active worker lease', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'no lease no assignment',
      taskType: 'IMPLEMENTATION',
      initialState: 'READY',
    });

    const result = h.orch.engine.apply({ taskId: task.id, event: 'WORKER_ASSIGNED', actor: 'test' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('active worker lease');
    h.orch.close();
  });

  it('rejects a DEPENDENCIES_SATISFIED claim that contradicts the graph', () => {
    const h = makeHarness();
    const upstream = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'upstream',
      taskType: 'IMPLEMENTATION',
    });
    const downstream = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'downstream',
      taskType: 'IMPLEMENTATION',
    });
    h.orch.store.addDependencyRow(downstream.id, upstream.id, 'DONE');

    const result = h.orch.engine.apply({
      taskId: downstream.id,
      event: 'DEPENDENCIES_SATISFIED',
      actor: 'liar',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('contradicts the dependency graph');
    h.orch.close();
  });
});
