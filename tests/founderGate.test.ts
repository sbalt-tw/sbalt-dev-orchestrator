import { afterAll, describe, expect, it } from 'vitest';
import { addWorkers, cleanupTempDirs, makeHarness, testPolicy, SHA_A, SHA_BASE } from './helpers.js';
import { checkGate } from '../src/policy/founderGate.js';

afterAll(cleanupTempDirs);

describe('Founder Gate', () => {
  it('will not lease a production-write resource without a resolved decision', () => {
    const h = makeHarness({
      policy: testPolicy({
        resources: [
          {
            name: 'production-write',
            capacity: 1,
            founderAuthorizationRequired: true,
            founderCategory: 'production_write',
          },
        ],
      }),
    });
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'deploy to production',
      taskType: 'DEPLOYMENT',
      requiresPr: false,
      requiredResources: ['production-write'],
    });

    const result = h.orch.tick();

    expect(result.dispatched).toHaveLength(0);
    expect(
      result.skipped.some((s) => s.reason.includes('FOUNDER_AUTHORIZATION_REQUIRED')),
    ).toBe(true);
    expect(h.orch.store.requireTask(task.id).state).toBe('READY');
    h.orch.close();
  });

  it('lets the work proceed once the matching decision is resolved', () => {
    const h = makeHarness({
      policy: testPolicy({
        resources: [
          {
            name: 'production-write',
            capacity: 1,
            founderAuthorizationRequired: true,
            founderCategory: 'production_write',
          },
        ],
      }),
    });
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'deploy to production',
      taskType: 'DEPLOYMENT',
      requiresPr: false,
      requiredResources: ['production-write'],
    });
    h.orch.tick();

    const decision = h.orch.store.createFounderDecision({
      taskId: task.id,
      category: 'production_write',
      question: 'apply to production?',
      provenance: 'test',
    });
    h.orch.store.setFounderDecisionState(decision.id, 'RESOLVED', 'approved', 'READY', 'APPROVED');

    const result = h.orch.tick();

    expect(result.dispatched).toHaveLength(1);
    expect(h.orch.store.requireTask(task.id).state).toBe('RUNNING');
    h.orch.close();
  });

  it("does not let one task's decision unblock another task", () => {
    const h = makeHarness({
      policy: testPolicy({
        resources: [
          {
            name: 'production-write',
            capacity: 1,
            founderAuthorizationRequired: true,
            founderCategory: 'production_write',
          },
        ],
      }),
    });
    addWorkers(h, 2);
    const authorised = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'authorised deploy',
      taskType: 'DEPLOYMENT',
      requiresPr: false,
      requiredResources: ['production-write'],
    });
    const other = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'unauthorised deploy',
      taskType: 'DEPLOYMENT',
      requiresPr: false,
      requiredResources: ['production-write'],
    });
    const decision = h.orch.store.createFounderDecision({
      taskId: authorised.id,
      category: 'production_write',
      question: 'apply to production?',
      provenance: 'test',
    });
    h.orch.store.setFounderDecisionState(decision.id, 'RESOLVED', 'approved', 'READY', 'APPROVED');

    const gateForOther = checkGate(
      h.orch.store,
      h.orch.policy,
      h.orch.store.requireTask(other.id),
      'production_write',
    );

    expect(gateForOther.satisfied).toBe(false);
    h.orch.close();
  });

  it('does not let a decision in one category open a different category', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'wrong category',
      taskType: 'IMPLEMENTATION',
    });
    const decision = h.orch.store.createFounderDecision({
      taskId: task.id,
      category: 'merge',
      question: 'merge?',
      provenance: 'test',
    });
    h.orch.store.setFounderDecisionState(decision.id, 'RESOLVED', 'approved', 'READY', 'APPROVED');

    const production = checkGate(
      h.orch.store,
      h.orch.policy,
      h.orch.store.requireTask(task.id),
      'production_write',
    );

    expect(production.satisfied).toBe(false);
    h.orch.close();
  });

  it('blocks a merge until a merge decision exists, and no prose can substitute', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'merge candidate',
      taskType: 'IMPLEMENTATION',
      initialState: 'READY_TO_MERGE',
    });
    h.orch.store.updateTaskFields(task.id, { prNumber: 1, prBaseSha: SHA_BASE, prHeadSha: SHA_A });
    h.orch.store.createReviewAttempt({
      taskId: task.id,
      reviewer: 'codex',
      round: 1,
      baseSha: SHA_BASE,
      headSha: SHA_A,
      status: 'COMPLETED_VERDICT',
    });

    // A worker asserting readiness in prose changes nothing.
    h.orch.submitReport({
      reportVersion: 1,
      taskId: task.id,
      laneId: h.laneId,
      workerId: 'wk_claims',
      status: 'COMPLETED',
      filesChanged: [],
      architectureDecisionRequired: false,
      recommendedNextAction: 'READY_TO_MERGE',
      summary: 'SAFE_TO_MERGE = YES',
    });

    const blocked = h.orch.engine.apply({ taskId: task.id, event: 'MERGED', actor: 'test' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toContain('founder-gated');
    expect(h.orch.store.requireTask(task.id).state).toBe('READY_TO_MERGE');

    const decisionId = h.orch.requireFounderDecision(task.id, 'merge', 'merge it?');
    h.orch.resolveFounderDecision(decisionId, 'approved', 'APPROVED');
    const merged = h.orch.engine.apply({ taskId: task.id, event: 'MERGED', actor: 'test' });

    expect(merged.ok).toBe(true);
    expect(h.orch.store.requireTask(task.id).state).toBe('DONE');
    h.orch.close();
  });

  it('refuses to resolve the same decision twice', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'single resolution',
      taskType: 'IMPLEMENTATION',
    });
    const id = h.orch.requireFounderDecision(task.id, 'architecture_change', 'change it?');
    expect(h.orch.resolveFounderDecision(id, 'yes', 'APPROVED').ok).toBe(true);
    const second = h.orch.resolveFounderDecision(id, 'yes again', 'APPROVED');
    expect(second.ok).toBe(false);
    h.orch.close();
  });
});
