import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator } from '../src/orchestrator.js';
import { policySchema, type Policy } from '../src/policy/schema.js';
import { FakeWorkerProvider } from '../src/workers/fake.js';
import { CAPABILITIES } from '../src/workers/provider.js';
import type { Clock } from '../src/state/store.js';
import { WORKER_REPORT_VERSION } from '../src/domain/report.js';

/** A clock the tests move by hand, so nothing depends on wall time. */
export class FakeClock implements Clock {
  constructor(private current = new Date('2026-01-01T00:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

const tempDirs: string[] = [];

export function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-orch-test-'));
  tempDirs.push(dir);
  return join(dir, 'state.sqlite');
}

export function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testPolicy(overrides: Record<string, unknown> = {}): Policy {
  return policySchema.parse({
    review: { standardMaxRounds: 3, highRiskMaxRounds: 5 },
    workers: { maxConcurrent: 3, leaseTtlMs: 60_000 },
    ...overrides,
  });
}

export interface Harness {
  orch: Orchestrator;
  provider: FakeWorkerProvider;
  laneId: string;
  projectId: string;
  clock: FakeClock;
}

export function makeHarness(
  options: { policy?: Policy; dbPath?: string; clock?: FakeClock; maxPrs?: number } = {},
): Harness {
  const clock = options.clock ?? new FakeClock();
  const orch = new Orchestrator({
    dbPath: options.dbPath ?? ':memory:',
    policy: options.policy ?? testPolicy(),
    clock,
  });
  orch.init();
  const provider = new FakeWorkerProvider([CAPABILITIES.implementation, CAPABILITIES.docs]);
  orch.registerProvider(provider);
  const project = orch.store.createProject(`p-${Math.random().toString(36).slice(2)}`, 'fake');
  const lane = orch.store.createLane({
    projectId: project.id,
    name: 'lane-1',
    maxActiveImplementationPrs: options.maxPrs ?? 1,
  });
  return { orch, provider, laneId: lane.id, projectId: project.id, clock };
}

/** Register N workers with the default capabilities. */
export function addWorkers(h: Harness, n: number): string[] {
  return Array.from({ length: n }, () =>
    h.orch.store.registerWorker({
      provider: 'fake',
      capabilities: [CAPABILITIES.implementation, CAPABILITIES.docs],
    }).id,
  );
}

export function baseReport(fields: {
  taskId: string;
  laneId: string;
  workerId: string;
}): Record<string, unknown> {
  return {
    reportVersion: WORKER_REPORT_VERSION,
    taskId: fields.taskId,
    laneId: fields.laneId,
    workerId: fields.workerId,
    status: 'NEEDS_REVIEW',
    filesChanged: [],
    architectureDecisionRequired: false,
    recommendedNextAction: 'NOOP',
  };
}

export const SHA_A = 'aaaaaaa1111111111111111111111111111111111';
export const SHA_B = 'bbbbbbb2222222222222222222222222222222222';
export const SHA_BASE = 'ccccccc3333333333333333333333333333333333';
