/**
 * Fake worker provider.
 *
 * Exists so orchestration semantics can be proven without running a real agent.
 * Reports are scripted per task, which keeps every test deterministic — no
 * network, no model, no wall-clock dependence.
 */

import type { WorkerReport } from '../domain/report.js';
import { WORKER_REPORT_VERSION } from '../domain/report.js';
import type { DispatchContext, WorkerProvider } from './provider.js';
import { CAPABILITIES } from './provider.js';

export type ScriptedReport = Omit<WorkerReport, 'reportVersion' | 'taskId' | 'laneId' | 'workerId'>;

export class FakeWorkerProvider implements WorkerProvider {
  readonly name = 'fake';
  private readonly script = new Map<string, ScriptedReport[]>();
  public readonly dispatched: DispatchContext[] = [];

  constructor(private readonly caps: string[] = [CAPABILITIES.implementation, CAPABILITIES.docs]) {}

  capabilities(): string[] {
    return [...this.caps];
  }

  /** Queue the reports this provider will return for a task, in order. */
  script_(taskId: string, reports: ScriptedReport[]): void {
    this.script.set(taskId, [...reports]);
  }

  async dispatch(context: DispatchContext): Promise<WorkerReport> {
    this.dispatched.push(context);
    const queue = this.script.get(context.task.id);
    const next = queue?.shift();
    if (!next) {
      return {
        reportVersion: WORKER_REPORT_VERSION,
        taskId: context.task.id,
        laneId: context.task.laneId,
        workerId: context.workerId,
        status: 'BLOCKED',
        filesChanged: [],
        architectureDecisionRequired: false,
        recommendedNextAction: 'NOOP',
        summary: 'fake worker had no scripted report',
      };
    }
    return {
      ...next,
      reportVersion: WORKER_REPORT_VERSION,
      taskId: context.task.id,
      laneId: context.task.laneId,
      workerId: context.workerId,
    };
  }
}
