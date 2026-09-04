import { afterAll, describe, expect, it } from 'vitest';
import { addWorkers, baseReport, cleanupTempDirs, makeHarness, SHA_A, SHA_BASE } from './helpers.js';
import { parseWorkerReport } from '../src/domain/report.js';
import { parseCoordinatorOutput, validateCoordinatorAction } from '../src/coordinator/validator.js';
import { StubCoordinator } from '../src/coordinator/stub.js';

afterAll(cleanupTempDirs);

describe('worker report contract', () => {
  it('rejects a report with an unknown field', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 't', taskType: 'DOCS', requiresPr: false });

    const result = h.orch.submitReport({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: 'wk_1' }),
      totallyUnexpected: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.applied).toHaveLength(0);
    expect(h.orch.store.requireTask(task.id).state).toBe('QUEUED');
    h.orch.close();
  });

  it('rejects a report missing a required field', () => {
    const parsed = parseWorkerReport({ reportVersion: 1, taskId: 't', laneId: 'l' });
    expect(parsed.ok).toBe(false);
  });

  it('rejects a report with an unknown status', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 't', taskType: 'DOCS', requiresPr: false });

    const result = h.orch.submitReport({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: 'wk_1' }),
      status: 'PROBABLY_FINE',
    });

    expect(result.accepted).toBe(false);
    h.orch.close();
  });

  it('rejects a report for an unknown task', () => {
    const h = makeHarness();
    const result = h.orch.submitReport(
      baseReport({ taskId: 'task_does_not_exist', laneId: h.laneId, workerId: 'wk_1' }),
    );
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('unknown task');
    h.orch.close();
  });

  it('rejects a report from a worker that does not hold the lease', () => {
    const h = makeHarness();
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'leased',
      taskType: 'DOCS',
      requiresPr: false,
    });
    h.orch.tick();

    const result = h.orch.submitReport(
      baseReport({ taskId: task.id, laneId: h.laneId, workerId: 'wk_impostor' }),
    );

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('leased to');
    h.orch.close();
  });

  it('records a rejected report so the failure is auditable', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 't', taskType: 'DOCS', requiresPr: false });
    h.orch.submitReport({ taskId: task.id, nonsense: true });

    const rows = h.orch.store.db
      .prepare('SELECT accepted, reason FROM worker_reports')
      .all() as Array<{ accepted: number; reason: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accepted).toBe(0);
    h.orch.close();
  });
});

describe('coordinator contract', () => {
  it('rejects an unknown action', () => {
    const parsed = parseCoordinatorOutput({ action: 'MERGE_IT_NOW', reason: 'trust me' });
    expect(parsed.ok).toBe(false);
  });

  it('rejects output with unexpected keys', () => {
    const parsed = parseCoordinatorOutput({ action: 'NOOP', reason: 'fine', override: true });
    expect(parsed.ok).toBe(false);
  });

  it('refuses READY_TO_MERGE when no clean verdict exists at the current head', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'not actually reviewed',
      taskType: 'IMPLEMENTATION',
      initialState: 'WAITING_REVIEW',
    });
    h.orch.store.updateTaskFields(task.id, { prNumber: 1, prBaseSha: SHA_BASE, prHeadSha: SHA_A });

    const validation = validateCoordinatorAction(
      h.orch.store,
      h.orch.policy,
      h.orch.store.requireTask(task.id),
      { action: 'READY_TO_MERGE', reason: 'looks good to me' },
    );

    expect(validation.allowed).toBe(false);
    h.orch.close();
  });

  it('refuses REQUEST_REVIEW before CI is green', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'ci pending',
      taskType: 'IMPLEMENTATION',
      initialState: 'WAITING_CI',
    });
    h.orch.store.updateTaskFields(task.id, { prNumber: 1, prHeadSha: SHA_A, ciStatus: 'PENDING' });

    const validation = validateCoordinatorAction(
      h.orch.store,
      h.orch.policy,
      h.orch.store.requireTask(task.id),
      { action: 'REQUEST_REVIEW', reason: 'start the review' },
    );

    expect(validation.allowed).toBe(false);
    h.orch.close();
  });

  it('refuses WAIT_DEPENDENCY when nothing is actually blocking', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 'free', taskType: 'DOCS', requiresPr: false });

    const validation = validateCoordinatorAction(
      h.orch.store,
      h.orch.policy,
      h.orch.store.requireTask(task.id),
      { action: 'WAIT_DEPENDENCY', reason: 'stalling' },
    );

    expect(validation.allowed).toBe(false);
    h.orch.close();
  });

  it('runs the stub coordinator end to end and records the validation', async () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'workable',
      taskType: 'DOCS',
      requiresPr: false,
      initialState: 'READY',
    });

    const result = await h.orch.consultCoordinator(task.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.action).toBe('CONTINUE_WORKER');
      expect(result.validation.allowed).toBe(true);
    }
    const recorded = h.orch.store
      .listEvents(task.id)
      .find((e) => e.eventType === 'COORDINATOR_ACTION_ACCEPTED');
    expect(recorded).toBeDefined();
    h.orch.close();
  });

  it('keeps the coordinator advisory: a merge proposal still meets the gate', async () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'clean but gated',
      taskType: 'IMPLEMENTATION',
      initialState: 'READY_TO_MERGE',
    });
    h.orch.store.updateTaskFields(task.id, { prNumber: 9, prBaseSha: SHA_BASE, prHeadSha: SHA_A });
    h.orch.store.createReviewAttempt({
      taskId: task.id,
      reviewer: 'codex',
      round: 1,
      baseSha: SHA_BASE,
      headSha: SHA_A,
      status: 'COMPLETED_VERDICT',
    });

    const coordinator = new StubCoordinator();
    const decision = await coordinator.decide(h.orch.snapshotFor(task.id));

    // Policy gates merge, so even a clean task routes to a Founder decision.
    expect(decision.action).toBe('FOUNDER_DECISION');
    h.orch.close();
  });
});
