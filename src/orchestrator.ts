/**
 * Orchestrator facade.
 *
 * Wires the durable store, the state engine, the resource manager, the policy,
 * the worker providers and the Coordinator into one object that the CLI, the
 * tests and the demo all drive.
 *
 * Two invariants live here. Worker reports are validated before they can move
 * any state, so a malformed report changes nothing. And Coordinator output is
 * validated before it is acted on, so the reasoning component stays advisory.
 */

import type { CoordinatorOutput, CoordinatorSnapshot } from './domain/coordinator.js';
import type { FounderDecisionCategory, Task } from './domain/entities.js';
import { parseWorkerReport, type WorkerReport } from './domain/report.js';
import type { TaskState } from './domain/states.js';
import { StateEngine, type ApplyResult } from './state/engine.js';
import { Store, type StoreOptions } from './state/store.js';
import { ResourceManager } from './resources/manager.js';
import { loadPolicy, type Policy } from './policy/schema.js';
import { cleanAtCurrentHead, nextRoundNumber, completedVerdictRounds } from './policy/review.js';
import { requireDecision } from './policy/founderGate.js';
import { dependencyStatuses } from './scheduler/dependencies.js';
import { tick, type DispatchIntent, type TickResult } from './scheduler/tick.js';
import { ProviderRegistry, type WorkerProvider } from './workers/provider.js';
import { StubCoordinator } from './coordinator/stub.js';
import { parseCoordinatorOutput, validateCoordinatorAction } from './coordinator/validator.js';
import type { Coordinator } from './domain/coordinator.js';
import type { ProjectAdapter } from './projects/adapter.js';
import { FakeProjectAdapter } from './projects/fake.js';

export interface OrchestratorOptions extends StoreOptions {
  policy?: Policy;
  policyPath?: string;
  coordinator?: Coordinator;
  adapter?: ProjectAdapter;
}

/**
 * Does this report make sense for the task it is reporting on?
 *
 * The schema checks shape; this checks meaning. Every accepted report must map
 * to at least one transition, otherwise the worker is released and the task is
 * left running with nobody working on it.
 */
function consistentWithTask(
  task: Task,
  report: WorkerReport,
): { ok: true } | { ok: false; reason: string } {
  if (report.status === 'FAILED' && !report.error) {
    return { ok: false, reason: 'a FAILED report must carry an error' };
  }
  if (report.status === 'COMPLETED' && task.requiresPr && !report.pr) {
    return {
      ok: false,
      reason: `task ${task.id} requires a PR; a COMPLETED report must include one`,
    };
  }
  if (
    report.status === 'BLOCKED' &&
    !report.founderDecisionRequired &&
    !report.architectureDecisionRequired &&
    !report.error
  ) {
    return {
      ok: false,
      reason: 'a BLOCKED report must say what blocks it: a decision request or an error',
    };
  }
  return { ok: true };
}

export interface AppliedEvent {
  event: string;
  result: ApplyResult;
}

export interface SubmitReportResult {
  accepted: boolean;
  reason?: string;
  issues?: string[];
  applied: AppliedEvent[];
}

export class Orchestrator {
  readonly store: Store;
  readonly policy: Policy;
  readonly engine: StateEngine;
  readonly resources: ResourceManager;
  readonly providers = new ProviderRegistry();
  readonly coordinator: Coordinator;
  readonly adapter: ProjectAdapter;

  constructor(options: OrchestratorOptions = {}) {
    this.store = new Store(options);
    this.policy = options.policy ?? loadPolicy(options.policyPath);
    this.engine = new StateEngine(this.store, this.policy);
    this.resources = new ResourceManager(this.store, this.policy);
    this.coordinator = options.coordinator ?? new StubCoordinator();
    this.adapter = options.adapter ?? new FakeProjectAdapter();
  }

  /** Load policy-declared resources into durable state. Safe to re-run. */
  init(): void {
    this.resources.syncDefinitions();
  }

  close(): void {
    this.store.close();
  }

  registerProvider(provider: WorkerProvider): void {
    this.providers.register(provider);
  }

  /** Uses the store's clock so lease expiry is judged on one timeline. */
  tick(now: Date = this.store.nowDate()): TickResult {
    return tick(this.store, this.engine, this.resources, this.policy, now);
  }

  // ------------------------------------------------------------- reports

  /**
   * Ingest a worker report. Invalid input is recorded and rejected without
   * touching workflow state — the report is the only channel a worker has, so
   * an unparseable one must not be guessed at.
   */
  submitReport(raw: unknown): SubmitReportResult {
    const parsed = parseWorkerReport(raw);
    if (!parsed.ok) {
      this.store.recordWorkerReport({
        taskId: typeof (raw as { taskId?: unknown })?.taskId === 'string'
          ? (raw as { taskId: string }).taskId
          : null,
        workerId: null,
        accepted: false,
        reason: parsed.reason,
        payload: raw,
      });
      return { accepted: false, reason: parsed.reason, issues: parsed.issues, applied: [] };
    }

    const report = parsed.report;
    const task = this.store.getTask(report.taskId);
    if (!task) {
      const reason = `report references unknown task ${report.taskId}`;
      this.store.recordWorkerReport({
        taskId: null,
        workerId: report.workerId,
        accepted: false,
        reason,
        payload: report,
      });
      return { accepted: false, reason, applied: [] };
    }

    const lease = this.store.getActiveWorkerLeaseForTask(task.id);
    if (lease && lease.workerId !== report.workerId) {
      const reason = `report from worker ${report.workerId} but task is leased to ${lease.workerId}`;
      this.store.recordWorkerReport({
        taskId: task.id,
        workerId: report.workerId,
        accepted: false,
        reason,
        payload: report,
      });
      return { accepted: false, reason, applied: [] };
    }

    // Schema validity is not enough: a report has to make sense for the task it
    // claims to finish. A COMPLETED report with no PR on a task that owes one
    // used to be accepted and then map to no transition at all, leaving the
    // task RUNNING with its lease released and invisible to reconciliation.
    const consistency = consistentWithTask(task, report);
    if (!consistency.ok) {
      this.store.recordWorkerReport({
        taskId: task.id,
        workerId: report.workerId,
        accepted: false,
        reason: consistency.reason,
        payload: report,
      });
      return { accepted: false, reason: consistency.reason, applied: [] };
    }

    this.store.recordWorkerReport({
      taskId: task.id,
      workerId: report.workerId,
      accepted: true,
      reason: null,
      payload: report,
    });

    return {
      accepted: true,
      applied: this.store.transaction(() => this.applyReport(task, report, lease?.id ?? null)),
    };
  }

  private releaseWorker(taskId: string, leaseId: string | null, workerId: string): void {
    if (leaseId) this.store.closeWorkerLease(leaseId, 'RELEASED');
    this.store.setWorkerStatus(workerId, 'IDLE');
    this.resources.releaseAllForTask(taskId);
  }

  private applyReport(task: Task, report: WorkerReport, leaseId: string | null): AppliedEvent[] {
    const applied: AppliedEvent[] = [];
    const actor = `worker:${report.workerId}`;

    // The worker is finished with this task either way; hand the compute back
    // before evaluating what the report says.
    this.releaseWorker(task.id, leaseId, report.workerId);

    // Infrastructure failure short-circuits everything else. It must not be
    // read as a task outcome and must not consume a review round.
    if (report.error?.kind === 'INFRA' || (report.status === 'FAILED' && report.error?.kind !== 'TASK')) {
      applied.push({
        event: 'INFRA_FAILURE',
        result: this.engine.apply({
          taskId: task.id,
          event: 'INFRA_FAILURE',
          actor,
          payload: { message: report.error?.message ?? 'worker reported failure' },
        }),
      });
      return applied;
    }

    // A failure in the work itself is rework, not an infrastructure block.
    if (report.status === 'FAILED' && report.error?.kind === 'TASK') {
      applied.push({
        event: 'WORKER_FAILED',
        result: this.engine.apply({
          taskId: task.id,
          event: 'WORKER_FAILED',
          actor,
          payload: { errorKind: 'TASK', message: report.error.message },
        }),
      });
      return applied;
    }

    if (report.pr) {
      this.store.updateTaskFields(task.id, {
        prNumber: report.pr.number,
        prBaseSha: report.pr.base,
        prHeadSha: report.pr.head,
      });
      applied.push({
        event: 'PR_OPENED',
        result: this.engine.apply({
          taskId: task.id,
          event: 'PR_OPENED',
          actor,
          payload: { pr: report.pr },
        }),
      });
    }

    if (report.ci) {
      this.store.updateTaskFields(task.id, { ciStatus: report.ci.status });
      const event = report.ci.status === 'PASSED' ? 'CI_PASSED' : report.ci.status === 'FAILED' ? 'CI_FAILED' : 'CI_STARTED';
      applied.push({
        event,
        result: this.engine.apply({ taskId: task.id, event, actor, payload: { ci: report.ci } }),
      });
    }

    if (report.review) {
      const priorAttempts = this.store.listReviewAttempts(task.id);
      const round =
        report.review.status === 'COMPLETED_VERDICT'
          ? nextRoundNumber(priorAttempts, this.policy)
          : completedVerdictRounds(priorAttempts, this.policy) + 1;
      const attempt = this.store.createReviewAttempt({
        taskId: task.id,
        reviewer: report.review.reviewer,
        round,
        baseSha: report.review.baseSha,
        headSha: report.review.headSha,
        blocker: report.review.blocker,
        high: report.review.high,
        medium: report.review.medium,
        low: report.review.low,
        status: report.review.status,
      });

      if (report.review.status === 'COMPLETED_VERDICT') {
        applied.push({
          event: 'CODEX_VERDICT',
          result: this.engine.apply({
            taskId: task.id,
            event: 'CODEX_VERDICT',
            actor,
            payload: { reviewAttemptId: attempt.id },
          }),
        });
      } else if (report.review.status === 'INFRA_ABORTED') {
        // Recorded, but it buys no progress and costs no round.
        applied.push({
          event: 'INFRA_FAILURE',
          result: this.engine.apply({
            taskId: task.id,
            event: 'INFRA_FAILURE',
            actor,
            payload: { reviewAttemptId: attempt.id, note: 'review aborted by infrastructure' },
          }),
        });
      }
    }

    // Both decision signals are honoured, and both are raised before any
    // completion transition. `architectureDecisionRequired` was previously
    // ignored, so a worker could report an architecture change and still take
    // the task straight to DONE with no decision recorded.
    const decisionRequests: Array<{ category: FounderDecisionCategory; question: string }> = [];
    if (report.founderDecisionRequired) {
      decisionRequests.push(report.founderDecisionRequired);
    }
    if (report.architectureDecisionRequired) {
      decisionRequests.push({
        category: 'architecture_change',
        question: `Worker flagged an architecture decision on "${task.title}".`,
      });
    }
    for (const request of decisionRequests) {
      const current = this.store.requireTask(task.id);
      const decision = requireDecision(
        this.store,
        current,
        request.category,
        request.question,
        actor,
      );
      applied.push({
        event: 'FOUNDER_DECISION_REQUIRED',
        result: this.engine.apply({
          taskId: task.id,
          event: 'FOUNDER_DECISION_REQUIRED',
          actor,
          payload: { category: request.category, decisionId: decision.id },
        }),
      });
    }

    // A task with no PR requirement finishes when its worker says so.
    if (report.status === 'COMPLETED' && !task.requiresPr && !report.pr && decisionRequests.length === 0) {
      applied.push({
        event: 'WORKER_COMPLETED',
        result: this.engine.apply({ taskId: task.id, event: 'WORKER_COMPLETED', actor }),
      });
    }

    // Backstop. The worker's lease is gone, so if the task is still RUNNING it
    // is unreachable by lease-based reconciliation. Rather than leave it
    // stranded, block it where an operator can see it.
    if (this.store.requireTask(task.id).state === 'RUNNING') {
      applied.push({
        event: 'INFRA_FAILURE',
        result: this.engine.apply({
          taskId: task.id,
          event: 'INFRA_FAILURE',
          actor,
          payload: { cause: 'accepted report produced no state transition' },
        }),
      });
    }

    return applied;
  }

  /** Convenience for the demo: run a provider and feed its report back in. */
  async runDispatch(intent: DispatchIntent, providerName: string): Promise<SubmitReportResult> {
    const provider = this.providers.get(providerName);
    if (!provider) return { accepted: false, reason: `unknown provider ${providerName}`, applied: [] };
    const task = this.store.requireTask(intent.taskId);
    const report = await provider.dispatch({
      task: {
        id: task.id,
        laneId: task.laneId,
        title: task.title,
        taskType: task.taskType,
        riskClass: task.riskClass,
        requiredCapabilities: task.requiredCapabilities,
      },
      workerId: intent.workerId,
      projectRefs: this.adapter.describe().authorityDocs,
    });
    return this.submitReport(report);
  }

  // --------------------------------------------------------- founder gate

  requireFounderDecision(
    taskId: string,
    category: FounderDecisionCategory,
    question: string,
    provenance = 'operator',
  ): string {
    const task = this.store.requireTask(taskId);
    const decision = requireDecision(this.store, task, category, question, provenance);
    this.engine.apply({
      taskId: task.id,
      event: 'FOUNDER_DECISION_REQUIRED',
      actor: provenance,
      payload: { category, decisionId: decision.id },
    });
    return decision.id;
  }

  /**
   * Resolve a decision and, when the task is parked in FOUNDER_DECISION, move
   * it on. A decision only ever unblocks the task it belongs to.
   */
  resolveFounderDecision(
    decisionId: string,
    resolution: string,
    target?: TaskState,
  ): { ok: boolean; reason?: string; transition?: ApplyResult } {
    const decision = this.store.getFounderDecision(decisionId);
    if (!decision) return { ok: false, reason: `unknown decision ${decisionId}` };
    if (decision.state !== 'REQUIRED') {
      return { ok: false, reason: `decision ${decisionId} is already ${decision.state}` };
    }
    // The destination is recorded on the decision itself. The engine then
    // derives the transition from that row, so a resolved decision can only
    // move the task it belongs to, to the place the Founder actually chose.
    const defaultTarget: TaskState =
      decision.category === 'merge'
        ? 'READY_TO_MERGE'
        : decision.category === 'review_budget_extension'
          ? 'REVIEW_FIX'
          : 'READY';
    const resolvedTarget = target ?? defaultTarget;

    return this.store.transaction(() => {
      this.store.setFounderDecisionState(decisionId, 'RESOLVED', resolution, resolvedTarget);
      this.store.appendEvent({
        taskId: decision.taskId,
        eventType: 'FOUNDER_DECISION_RESOLVED',
        actor: 'founder',
        payload: { decisionId, category: decision.category, resolution, resolvedTarget },
      });

      if (!decision.taskId) return { ok: true };
      const task = this.store.getTask(decision.taskId);
      if (!task || task.state !== 'FOUNDER_DECISION') return { ok: true };

      const transition = this.engine.apply({
        taskId: task.id,
        event: 'FOUNDER_DECISION_RESOLVED',
        actor: 'founder',
        payload: { decisionId },
      });
      return { ok: transition.ok, transition, ...(transition.ok ? {} : { reason: transition.reason }) };
    });
  }

  // ---------------------------------------------------------- coordinator

  snapshotFor(taskId: string): CoordinatorSnapshot {
    const task = this.store.requireTask(taskId);
    const lane = this.store.getLane(task.laneId);
    if (!lane) throw new Error(`task ${taskId} has no lane`);
    const attempts = this.store.listReviewAttempts(task.id);
    const latest = attempts.length > 0 ? attempts[attempts.length - 1] : undefined;

    return {
      task: {
        id: task.id,
        laneId: task.laneId,
        title: task.title,
        taskType: task.taskType,
        state: task.state,
        riskClass: task.riskClass,
        requiresPr: task.requiresPr,
        prNumber: task.prNumber,
        prHeadSha: task.prHeadSha,
        prBaseSha: task.prBaseSha,
        ciStatus: task.ciStatus,
        requiredResources: task.requiredResources,
      },
      lane: {
        id: lane.id,
        name: lane.name,
        riskClass: lane.riskClass,
        maxActiveImplementationPrs: lane.maxActiveImplementationPrs,
        status: lane.status,
      },
      dependencies: dependencyStatuses(this.store, task.id).map((d) => ({
        dependsOnTaskId: d.dependsOnTaskId,
        requiredState: d.requiredState,
        actualState: d.actualState,
        satisfied: d.satisfied,
      })),
      policy: {
        reviewMaxRounds:
          task.reviewMaxRounds ??
          (task.riskClass === 'HIGH'
            ? this.policy.review.highRiskMaxRounds
            : this.policy.review.standardMaxRounds),
        stopWhenBlocker: this.policy.review.stopWhen.blocker,
        stopWhenHigh: this.policy.review.stopWhen.high,
        mergeRequiresFounder: this.policy.merge.default === 'founderRequired',
        stagingWriteRequiresFounder: this.policy.remoteWrites.staging === 'founderRequired',
        productionWriteRequiresFounder: this.policy.remoteWrites.production === 'founderRequired',
      },
      review: {
        completedVerdictRounds: completedVerdictRounds(attempts, this.policy),
        latestAttempt: latest
          ? {
              round: latest.round,
              headSha: latest.headSha,
              blocker: latest.blocker,
              high: latest.high,
              medium: latest.medium,
              low: latest.low,
              status: latest.status,
            }
          : null,
        cleanAtCurrentHead: cleanAtCurrentHead(task, attempts, this.policy),
      },
      founderDecisions: this.store
        .listFounderDecisions({ taskId: task.id })
        .map((d) => ({ id: d.id, category: d.category, state: d.state, question: d.question })),
      projectAuthorityRefs: this.adapter.describe().authorityDocs,
      latestWorkerReport: this.store.latestWorkerReport(task.id),
    };
  }

  /**
   * Ask the Coordinator what to do next, then validate its answer. The returned
   * `validation` is the authority; `output` is only a proposal.
   */
  async consultCoordinator(
    taskId: string,
  ): Promise<
    | { ok: true; output: CoordinatorOutput; validation: { allowed: boolean; reason: string } }
    | { ok: false; reason: string; issues?: string[] }
  > {
    const task = this.store.requireTask(taskId);
    const snapshot = this.snapshotFor(taskId);
    const raw = await this.coordinator.decide(snapshot);
    const parsed = parseCoordinatorOutput(raw);
    if (!parsed.ok) {
      this.store.appendEvent({
        taskId,
        eventType: 'COORDINATOR_OUTPUT_REJECTED',
        actor: `coordinator:${this.coordinator.name}`,
        payload: { reason: parsed.reason, issues: parsed.issues },
      });
      return { ok: false, reason: parsed.reason, issues: parsed.issues };
    }
    const validation = validateCoordinatorAction(this.store, this.policy, task, parsed.output);
    this.store.appendEvent({
      taskId,
      eventType: validation.allowed ? 'COORDINATOR_ACTION_ACCEPTED' : 'COORDINATOR_ACTION_REJECTED',
      actor: `coordinator:${this.coordinator.name}`,
      payload: { action: parsed.output.action, reason: parsed.output.reason, validation },
    });
    return { ok: true, output: parsed.output, validation };
  }
}
