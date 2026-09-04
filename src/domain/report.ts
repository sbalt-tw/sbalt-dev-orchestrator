/**
 * Structured worker report contract.
 *
 * A worker communicates with the orchestrator through this object and nothing
 * else. The workflow never depends on parsing prose: `summary` exists for
 * humans and is ignored by the engine.
 *
 * The schema is strict. Unknown keys, unknown enum members and missing required
 * fields all fail closed — a malformed report is rejected rather than
 * best-effort interpreted, because a silently misread report would move real
 * workflow state.
 */

import { z } from 'zod';
import { COORDINATOR_ACTIONS } from './coordinator.js';
import { FOUNDER_DECISION_CATEGORIES, REVIEW_ATTEMPT_STATUSES } from './entities.js';

export const WORKER_REPORT_VERSION = 1;

export const WORKER_REPORT_STATUSES = [
  'COMPLETED',
  'NEEDS_REVIEW',
  'BLOCKED',
  'FAILED',
] as const;
export type WorkerReportStatus = (typeof WORKER_REPORT_STATUSES)[number];

const prSchema = z
  .object({
    number: z.number().int().positive(),
    head: z.string().min(7),
    base: z.string().min(7),
    state: z.enum(['OPEN', 'MERGED', 'CLOSED']),
  })
  .strict();

const ciSchema = z
  .object({
    status: z.enum(['PENDING', 'PASSED', 'FAILED']),
    checks: z
      .array(
        z
          .object({
            name: z.string().min(1),
            conclusion: z.enum(['PASS', 'FAIL', 'PENDING']),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const reviewSchema = z
  .object({
    reviewer: z.string().min(1),
    round: z.number().int().positive(),
    baseSha: z.string().min(7),
    headSha: z.string().min(7),
    blocker: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    status: z.enum(REVIEW_ATTEMPT_STATUSES),
  })
  .strict();

const errorSchema = z
  .object({
    /**
     * INFRA means the environment failed (disk full, lock held, network) and
     * the attempt should not be counted against the task's budgets. TASK means
     * the work itself failed.
     */
    kind: z.enum(['INFRA', 'TASK']),
    message: z.string().min(1),
  })
  .strict();

export const workerReportSchema = z
  .object({
    reportVersion: z.literal(WORKER_REPORT_VERSION),
    taskId: z.string().min(1),
    laneId: z.string().min(1),
    workerId: z.string().min(1),
    status: z.enum(WORKER_REPORT_STATUSES),
    filesChanged: z.array(z.string()).default([]),
    pr: prSchema.optional(),
    ci: ciSchema.optional(),
    review: reviewSchema.optional(),
    founderDecisionRequired: z
      .object({
        category: z.enum(FOUNDER_DECISION_CATEGORIES),
        question: z.string().min(1),
      })
      .strict()
      .optional(),
    architectureDecisionRequired: z.boolean().default(false),
    recommendedNextAction: z.enum(COORDINATOR_ACTIONS),
    error: errorSchema.optional(),
    summary: z.string().optional(),
  })
  .strict();

export type WorkerReport = z.infer<typeof workerReportSchema>;

export interface ReportParseSuccess {
  ok: true;
  report: WorkerReport;
}

export interface ReportParseFailure {
  ok: false;
  /** Human-readable reason; also persisted so the failure is auditable. */
  reason: string;
  issues: string[];
}

export type ReportParseResult = ReportParseSuccess | ReportParseFailure;

/** Fail-closed parse. Never throws; callers must handle `ok: false`. */
export function parseWorkerReport(input: unknown): ReportParseResult {
  const parsed = workerReportSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, report: parsed.data };
  }
  const issues = parsed.error.issues.map(
    (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
  );
  return {
    ok: false,
    reason: 'worker report failed schema validation',
    issues,
  };
}
