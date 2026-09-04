import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDirs, makeHarness, testPolicy, SHA_A, SHA_B, SHA_BASE } from './helpers.js';
import { completedVerdictRounds, reviewBudget, cleanAtCurrentHead } from '../src/policy/review.js';

afterAll(cleanupTempDirs);

function reviewTask(h: ReturnType<typeof makeHarness>, head = SHA_A) {
  const task = h.orch.store.createTask({
    laneId: h.laneId,
    title: 'under review',
    taskType: 'IMPLEMENTATION',
    initialState: 'WAITING_REVIEW',
  });
  h.orch.store.updateTaskFields(task.id, { prNumber: 1, prBaseSha: SHA_BASE, prHeadSha: head });
  return h.orch.store.requireTask(task.id);
}

function reviewReport(
  h: ReturnType<typeof makeHarness>,
  taskId: string,
  over: Record<string, unknown>,
): Record<string, unknown> {
  return {
    reportVersion: 1,
    taskId,
    laneId: h.laneId,
    workerId: 'wk_reviewer',
    status: 'NEEDS_REVIEW',
    filesChanged: [],
    architectureDecisionRequired: false,
    recommendedNextAction: 'NOOP',
    review: {
      reviewer: 'codex',
      round: 1,
      baseSha: SHA_BASE,
      headSha: SHA_A,
      blocker: 0,
      high: 0,
      medium: 0,
      low: 0,
      status: 'COMPLETED_VERDICT',
      ...over,
    },
  };
}

describe('review model', () => {
  it('stops early on 0 blocker / 0 high', () => {
    const h = makeHarness();
    const task = reviewTask(h);

    h.orch.submitReport(reviewReport(h, task.id, {}));

    expect(h.orch.store.requireTask(task.id).state).toBe('READY_TO_MERGE');
    expect(completedVerdictRounds(h.orch.store.listReviewAttempts(task.id), h.orch.policy)).toBe(1);
    h.orch.close();
  });

  it('sends the task back for a fix when a HIGH is found', () => {
    const h = makeHarness();
    const task = reviewTask(h);

    h.orch.submitReport(reviewReport(h, task.id, { high: 1 }));

    expect(h.orch.store.requireTask(task.id).state).toBe('REVIEW_FIX');
    h.orch.close();
  });

  it('sends the task back for a fix when a BLOCKER is found', () => {
    const h = makeHarness();
    const task = reviewTask(h);

    h.orch.submitReport(reviewReport(h, task.id, { blocker: 1 }));

    expect(h.orch.store.requireTask(task.id).state).toBe('REVIEW_FIX');
    h.orch.close();
  });

  it('escalates to the Founder when the round budget is exhausted with findings open', () => {
    const h = makeHarness({
      policy: testPolicy({ review: { standardMaxRounds: 1, highRiskMaxRounds: 1 } }),
    });
    const task = reviewTask(h);

    h.orch.submitReport(reviewReport(h, task.id, { high: 1 }));

    expect(h.orch.store.requireTask(task.id).state).toBe('FOUNDER_DECISION');
    const budget = reviewBudget(
      h.orch.store.requireTask(task.id),
      h.orch.store.listReviewAttempts(task.id),
      h.orch.policy,
    );
    expect(budget.exhausted).toBe(true);
    h.orch.close();
  });

  it('does not let an infrastructure abort consume a verdict round', () => {
    const h = makeHarness({
      policy: testPolicy({ review: { standardMaxRounds: 2, highRiskMaxRounds: 2 } }),
    });
    const task = reviewTask(h);

    // Two reviews killed by infrastructure.
    h.orch.submitReport(reviewReport(h, task.id, { status: 'INFRA_ABORTED' }));
    h.orch.engine.apply({ taskId: task.id, event: 'RECOVERED', actor: 'test', target: 'WAITING_REVIEW' });
    h.orch.submitReport(reviewReport(h, task.id, { status: 'INFRA_ABORTED' }));
    h.orch.engine.apply({ taskId: task.id, event: 'RECOVERED', actor: 'test', target: 'WAITING_REVIEW' });

    const attempts = h.orch.store.listReviewAttempts(task.id);
    expect(attempts).toHaveLength(2);
    expect(completedVerdictRounds(attempts, h.orch.policy)).toBe(0);

    // A real verdict with a finding still has budget left, so it is a fix, not
    // an escalation.
    h.orch.submitReport(reviewReport(h, task.id, { high: 1 }));

    expect(h.orch.store.requireTask(task.id).state).toBe('REVIEW_FIX');
    expect(completedVerdictRounds(h.orch.store.listReviewAttempts(task.id), h.orch.policy)).toBe(1);
    h.orch.close();
  });

  it('counts an infra abort as a round only when policy says so', () => {
    const h = makeHarness({
      policy: testPolicy({
        review: { standardMaxRounds: 1, highRiskMaxRounds: 1, infraAbortConsumesRound: true },
      }),
    });
    const task = reviewTask(h);

    h.orch.submitReport(reviewReport(h, task.id, { status: 'INFRA_ABORTED' }));

    expect(completedVerdictRounds(h.orch.store.listReviewAttempts(task.id), h.orch.policy)).toBe(1);
    h.orch.close();
  });

  it('does not treat a clean verdict on an older head as merge readiness', () => {
    const h = makeHarness();
    const task = reviewTask(h, SHA_A);

    // Clean verdict at SHA_A.
    h.orch.submitReport(reviewReport(h, task.id, {}));
    expect(h.orch.store.requireTask(task.id).state).toBe('READY_TO_MERGE');

    // The branch then moves to a new head.
    h.orch.store.updateTaskFields(task.id, { prHeadSha: SHA_B });
    const moved = h.orch.store.requireTask(task.id);
    expect(cleanAtCurrentHead(moved, h.orch.store.listReviewAttempts(task.id), h.orch.policy)).toBe(false);

    const merged = h.orch.engine.apply({ taskId: task.id, event: 'MERGED', actor: 'test' });
    expect(merged.ok).toBe(false);
    if (!merged.ok) expect(merged.reason).toMatch(/exact current head|founder-gated/);

    const mergeReady = h.orch.engine.apply({ taskId: task.id, event: 'MERGE_READY', actor: 'test' });
    expect(mergeReady.ok).toBe(false);
    h.orch.close();
  });

  it('refuses to drive CODEX_VERDICT from an attempt that produced no verdict', () => {
    const h = makeHarness();
    const task = reviewTask(h);
    const attempt = h.orch.store.createReviewAttempt({
      taskId: task.id,
      reviewer: 'codex',
      round: 1,
      baseSha: SHA_BASE,
      headSha: SHA_A,
      status: 'INFRA_ABORTED',
    });

    const result = h.orch.engine.apply({
      taskId: task.id,
      event: 'CODEX_VERDICT',
      actor: 'test',
      payload: { reviewAttemptId: attempt.id },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('INFRA_ABORTED');
    h.orch.close();
  });
});
