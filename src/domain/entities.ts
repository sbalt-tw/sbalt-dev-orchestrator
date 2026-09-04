/**
 * Durable entity shapes.
 *
 * These mirror the SQLite tables. Only fields the Phase-0 state machine and its
 * tests actually need are present; the model is deliberately not generalised
 * ahead of a real requirement.
 */

import { z } from 'zod';
import { TASK_STATES, type TaskState } from './states.js';

export const RISK_CLASSES = ['LOW', 'STANDARD', 'HIGH'] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

export const TASK_TYPES = [
  'IMPLEMENTATION',
  'DOCS',
  'REVIEW_FIX',
  'INVESTIGATION',
  'DEPLOYMENT',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const LANE_STATUSES = ['ACTIVE', 'PAUSED', 'CLOSED'] as const;
export type LaneStatus = (typeof LANE_STATUSES)[number];

export const WORKER_STATUSES = ['IDLE', 'BUSY', 'OFFLINE'] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

export const LEASE_STATUSES = ['ACTIVE', 'RELEASED', 'STALE'] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export const CI_STATUSES = ['NONE', 'PENDING', 'PASSED', 'FAILED'] as const;
export type CiStatus = (typeof CI_STATUSES)[number];

/**
 * A review attempt either produced a verdict or was killed by infrastructure.
 * Only COMPLETED_VERDICT consumes a round of the review budget — an
 * infrastructure abort must never cost the task one of its rounds.
 */
export const REVIEW_ATTEMPT_STATUSES = ['RUNNING', 'COMPLETED_VERDICT', 'INFRA_ABORTED'] as const;
export type ReviewAttemptStatus = (typeof REVIEW_ATTEMPT_STATUSES)[number];

export const FOUNDER_DECISION_CATEGORIES = [
  'architecture_change',
  'product_semantics_change',
  'review_budget_extension',
  'staging_write',
  'production_write',
  'destructive_operation',
  'rollback',
  'merge',
] as const;
export type FounderDecisionCategory = (typeof FOUNDER_DECISION_CATEGORIES)[number];

export const FOUNDER_DECISION_STATES = ['REQUIRED', 'RESOLVED', 'REJECTED', 'WITHDRAWN'] as const;
export type FounderDecisionState = (typeof FOUNDER_DECISION_STATES)[number];

export interface Project {
  id: string;
  name: string;
  adapterId: string;
  createdAt: string;
}

export interface Lane {
  id: string;
  projectId: string;
  name: string;
  riskClass: RiskClass;
  maxActiveImplementationPrs: number;
  status: LaneStatus;
  createdAt: string;
}

export interface Task {
  id: string;
  laneId: string;
  title: string;
  taskType: TaskType;
  state: TaskState;
  riskClass: RiskClass;
  priority: number;
  /** Whether this task must open a PR before it can reach DONE. */
  requiresPr: boolean;
  /** Logical resources this task must hold before a worker may be dispatched. */
  requiredResources: string[];
  /** Worker capabilities a worker must have to be assigned this task. */
  requiredCapabilities: string[];
  prNumber: number | null;
  prBaseSha: string | null;
  prHeadSha: string | null;
  ciStatus: CiStatus;
  /** Null means "use the policy default for this risk class". */
  reviewMaxRounds: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDependency {
  taskId: string;
  dependsOnTaskId: string;
  requiredState: TaskState;
}

export interface Worker {
  id: string;
  provider: string;
  capabilities: string[];
  status: WorkerStatus;
  createdAt: string;
  lastSeenAt: string;
}

export interface WorkerLease {
  id: string;
  taskId: string;
  workerId: string;
  startedAt: string;
  heartbeatAt: string;
  expiresAt: string;
  status: LeaseStatus;
}

export interface ResourceDefinition {
  name: string;
  capacity: number;
  /** When true, a lease may only be granted after a resolved Founder decision. */
  founderAuthorizationRequired: boolean;
  /**
   * Which decision category authorises this resource.
   *
   * A gated resource with no category would have nothing to check and would
   * lease itself, so the pair is enforced by the policy parser, the resource
   * manager and a database CHECK constraint.
   */
  founderCategory: FounderDecisionCategory | null;
}

export interface ResourceLease {
  id: string;
  resourceName: string;
  taskId: string;
  workerId: string | null;
  acquiredAt: string;
  expiresAt: string | null;
  status: LeaseStatus;
}

export interface ReviewAttempt {
  id: string;
  taskId: string;
  reviewer: string;
  round: number;
  baseSha: string;
  headSha: string;
  blocker: number;
  high: number;
  medium: number;
  low: number;
  status: ReviewAttemptStatus;
  createdAt: string;
  completedAt: string | null;
}

export interface FounderDecision {
  id: string;
  taskId: string | null;
  category: FounderDecisionCategory;
  question: string;
  state: FounderDecisionState;
  resolution: string | null;
  /**
   * Where the Founder's answer sends the task.
   *
   * Recorded when the decision is resolved so the engine derives the
   * destination from the decision itself. Without it, any resolved decision on
   * a task could drive any allowed target — an architecture approval could
   * push a task to READY_TO_MERGE.
   */
  resolvedTarget: TaskState | null;
  provenance: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface HistoryEvent {
  id: string;
  taskId: string | null;
  eventType: string;
  actor: string;
  fromState: TaskState | null;
  toState: TaskState | null;
  payload: unknown;
  createdAt: string;
}

/** Runtime validation for operator-supplied task creation input. */
export const taskCreateInputSchema = z
  .object({
    laneId: z.string().min(1),
    title: z.string().min(1),
    taskType: z.enum(TASK_TYPES),
    riskClass: z.enum(RISK_CLASSES).default('STANDARD'),
    priority: z.number().int().default(0),
    requiresPr: z.boolean().default(true),
    requiredResources: z.array(z.string().min(1)).default([]),
    requiredCapabilities: z.array(z.string().min(1)).default([]),
    reviewMaxRounds: z.number().int().positive().nullable().default(null),
    initialState: z.enum(TASK_STATES).default('QUEUED'),
  })
  .strict();

export type TaskCreateInput = z.input<typeof taskCreateInputSchema>;
