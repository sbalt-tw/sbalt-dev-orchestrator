/**
 * Phase-0 demonstration scenario.
 *
 * Entirely synthetic: an in-memory database, fake workers, and invented commit
 * SHAs. No repository is read or written, no live PR is referenced, and no
 * remote environment is contacted. It exists to show the orchestration
 * semantics end to end.
 *
 * The shape it walks through is the one the workflow actually has: two tasks
 * proceed in parallel while a third waits on a dependency, a review comes back
 * with a HIGH finding and sends its task back for rework, a later review comes
 * back clean, and the merge still stops at the Founder Gate until a decision is
 * recorded.
 */

import { Orchestrator } from '../orchestrator.js';
import { DEFAULT_POLICY, policySchema } from '../policy/schema.js';
import { FakeWorkerProvider } from '../workers/fake.js';
import { CAPABILITIES } from '../workers/provider.js';
import { addDependency } from '../scheduler/dependencies.js';
import { WORKER_REPORT_VERSION } from '../domain/report.js';

export interface DemoResult {
  timeline: string[];
  finalStates: Record<string, string>;
  founderGateBlockedMerge: boolean;
  reviewRounds: number;
}

export async function runDemo(): Promise<DemoResult> {
  const timeline: string[] = [];
  const say = (line: string): void => {
    timeline.push(line);
  };

  const policy = policySchema.parse({
    ...DEFAULT_POLICY,
    workers: { maxConcurrent: 2, leaseTtlMs: DEFAULT_POLICY.workers.leaseTtlMs },
  });

  const orch = new Orchestrator({ dbPath: ':memory:', policy });
  orch.init();
  const provider = new FakeWorkerProvider([CAPABILITIES.implementation, CAPABILITIES.docs]);
  orch.registerProvider(provider);

  const project = orch.store.createProject('demo-project', 'fake');
  const coreLane = orch.store.createLane({
    projectId: project.id,
    name: 'core',
    riskClass: 'HIGH',
    maxActiveImplementationPrs: 1,
  });
  const docsLane = orch.store.createLane({
    projectId: project.id,
    name: 'docs',
    riskClass: 'LOW',
    maxActiveImplementationPrs: 1,
  });

  const taskA = orch.store.createTask({
    laneId: coreLane.id,
    title: 'Task A — high-risk implementation (synthetic)',
    taskType: 'IMPLEMENTATION',
    riskClass: 'HIGH',
    priority: 10,
    requiresPr: true,
    requiredResources: ['codex'],
    requiredCapabilities: [CAPABILITIES.implementation],
  });
  const taskB = orch.store.createTask({
    laneId: coreLane.id,
    title: 'Task B — finalisation, depends on A (synthetic)',
    taskType: 'IMPLEMENTATION',
    riskClass: 'STANDARD',
    priority: 5,
    requiresPr: true,
    requiredCapabilities: [CAPABILITIES.implementation],
  });
  const taskC = orch.store.createTask({
    laneId: docsLane.id,
    title: 'Task C — independent docs work (synthetic)',
    taskType: 'DOCS',
    riskClass: 'LOW',
    priority: 8,
    requiresPr: false,
    requiredCapabilities: [CAPABILITIES.docs],
  });

  addDependency(orch.store, taskB.id, taskA.id, 'DONE');
  say(`created tasks A, B, C. B depends on A reaching DONE.`);

  const w1 = orch.store.registerWorker({ provider: 'fake', capabilities: provider.capabilities() });
  const w2 = orch.store.registerWorker({ provider: 'fake', capabilities: provider.capabilities() });
  say(`registered 2 disposable workers (${w1.id}, ${w2.id}); concurrency ceiling is ${policy.workers.maxConcurrent}.`);

  // --- tick 1: A and C run, B waits -----------------------------------------
  const t1 = orch.tick();
  say(
    `tick 1: dispatched ${t1.dispatched.length} task(s); A=${orch.store.requireTask(taskA.id).state}, ` +
      `B=${orch.store.requireTask(taskB.id).state}, C=${orch.store.requireTask(taskC.id).state}`,
  );
  say(`  A holds the single 'codex' slot; ${orch.resources.available('codex')} left.`);

  // --- A opens a PR and CI goes green ---------------------------------------
  const headV1 = 'aaaaaaa1111111111111111111111111111111111';
  orch.submitReport({
    reportVersion: WORKER_REPORT_VERSION,
    taskId: taskA.id,
    laneId: coreLane.id,
    workerId: w1.id,
    status: 'NEEDS_REVIEW',
    filesChanged: ['src/thing.ts'],
    pr: { number: 101, head: headV1, base: 'bbbbbbb2222222222222222222222222222222222', state: 'OPEN' },
    ci: { status: 'PASSED' },
    architectureDecisionRequired: false,
    recommendedNextAction: 'REQUEST_REVIEW',
  });
  say(`A reported a PR and green CI -> ${orch.store.requireTask(taskA.id).state}`);

  // --- C finishes independently ---------------------------------------------
  orch.submitReport({
    reportVersion: WORKER_REPORT_VERSION,
    taskId: taskC.id,
    laneId: docsLane.id,
    workerId: w2.id,
    status: 'COMPLETED',
    filesChanged: ['docs/guide.md'],
    architectureDecisionRequired: false,
    recommendedNextAction: 'NOOP',
  });
  say(`C completed independently -> ${orch.store.requireTask(taskC.id).state}`);

  // --- review round 1: a HIGH finding sends A back --------------------------
  orch.submitReport({
    reportVersion: WORKER_REPORT_VERSION,
    taskId: taskA.id,
    laneId: coreLane.id,
    workerId: w1.id,
    status: 'NEEDS_REVIEW',
    filesChanged: [],
    review: {
      reviewer: 'codex',
      round: 1,
      baseSha: 'bbbbbbb2222222222222222222222222222222222',
      headSha: headV1,
      blocker: 0,
      high: 1,
      medium: 2,
      low: 0,
      status: 'COMPLETED_VERDICT',
    },
    architectureDecisionRequired: false,
    recommendedNextAction: 'CONTINUE_WORKER',
  });
  say(`review round 1 returned HIGH=1 -> A=${orch.store.requireTask(taskA.id).state}`);

  // --- tick 2: A is re-dispatched for the fix -------------------------------
  const t2 = orch.tick();
  say(`tick 2: dispatched ${t2.dispatched.length} task(s); A=${orch.store.requireTask(taskA.id).state}`);
  say(`  B is still ${orch.store.requireTask(taskB.id).state} because A has not reached DONE.`);

  // --- A pushes a new head, CI green again ----------------------------------
  const headV2 = 'ccccccc3333333333333333333333333333333333';
  const fixWorker = orch.store.getActiveWorkerLeaseForTask(taskA.id)?.workerId ?? w1.id;
  orch.submitReport({
    reportVersion: WORKER_REPORT_VERSION,
    taskId: taskA.id,
    laneId: coreLane.id,
    workerId: fixWorker,
    status: 'NEEDS_REVIEW',
    filesChanged: ['src/thing.ts'],
    pr: { number: 101, head: headV2, base: 'bbbbbbb2222222222222222222222222222222222', state: 'OPEN' },
    ci: { status: 'PASSED' },
    architectureDecisionRequired: false,
    recommendedNextAction: 'REQUEST_REVIEW',
  });
  say(`A pushed a fix (new head) and CI passed -> ${orch.store.requireTask(taskA.id).state}`);

  // --- review round 2: clean at the new head --------------------------------
  orch.submitReport({
    reportVersion: WORKER_REPORT_VERSION,
    taskId: taskA.id,
    laneId: coreLane.id,
    workerId: fixWorker,
    status: 'NEEDS_REVIEW',
    filesChanged: [],
    review: {
      reviewer: 'codex',
      round: 2,
      baseSha: 'bbbbbbb2222222222222222222222222222222222',
      headSha: headV2,
      blocker: 0,
      high: 0,
      medium: 0,
      low: 1,
      status: 'COMPLETED_VERDICT',
    },
    architectureDecisionRequired: false,
    recommendedNextAction: 'READY_TO_MERGE',
  });
  say(`review round 2 returned 0 blocker / 0 high -> A=${orch.store.requireTask(taskA.id).state}`);

  // --- the Founder Gate stops the merge -------------------------------------
  const blocked = orch.engine.apply({ taskId: taskA.id, event: 'MERGED', actor: 'demo' });
  const founderGateBlockedMerge = !blocked.ok;
  say(`merge attempted without a decision -> ${blocked.ok ? 'ALLOWED (unexpected)' : `BLOCKED: ${blocked.reason}`}`);

  const decisionId = orch.requireFounderDecision(
    taskA.id,
    'merge',
    'Merge Task A at the reviewed head?',
    'demo',
  );
  say(`recorded founder decision ${decisionId} -> A=${orch.store.requireTask(taskA.id).state}`);

  orch.resolveFounderDecision(decisionId, 'approved by Founder');
  say(`founder resolved the decision -> A=${orch.store.requireTask(taskA.id).state}`);

  const merged = orch.engine.apply({ taskId: taskA.id, event: 'MERGED', actor: 'demo' });
  say(`merge after resolution -> ${merged.ok ? `A=${orch.store.requireTask(taskA.id).state}` : `still blocked: ${merged.reason}`}`);

  // --- tick 3: B unblocks ----------------------------------------------------
  const t3 = orch.tick();
  say(`tick 3: B=${orch.store.requireTask(taskB.id).state} (dispatched ${t3.dispatched.length})`);

  const finalStates: Record<string, string> = {
    A: orch.store.requireTask(taskA.id).state,
    B: orch.store.requireTask(taskB.id).state,
    C: orch.store.requireTask(taskC.id).state,
  };
  const reviewRounds = orch.store.listReviewAttempts(taskA.id).length;
  orch.close();

  return { timeline, finalStates, founderGateBlockedMerge, reviewRounds };
}
