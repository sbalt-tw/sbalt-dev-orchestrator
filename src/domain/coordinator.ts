/**
 * GPT Coordinator contract.
 *
 * The Coordinator is a reasoning component, not a safety gate. It receives a
 * bounded snapshot and returns a structured action. The deterministic
 * orchestrator then validates that action against policy and the state machine
 * before anything happens, so a wrong or adversarial Coordinator output can
 * stall work but cannot bypass a gate.
 *
 * Phase 0 ships the interface plus a deterministic stub. There is no live API
 * integration.
 */

import { z } from 'zod';
import {
  FOUNDER_DECISION_CATEGORIES,
  RISK_CLASSES,
  TASK_TYPES,
  type FounderDecision,
  type Lane,
  type ReviewAttempt,
  type Task,
} from './entities.js';
import { TASK_STATES } from './states.js';

export const COORDINATOR_ACTIONS = [
  'CONTINUE_WORKER',
  'SPAWN_TASK',
  'WAIT_DEPENDENCY',
  'REQUEST_REVIEW',
  'FOUNDER_DECISION',
  'BLOCK_INFRA',
  'READY_TO_MERGE',
  'NOOP',
] as const;

export type CoordinatorAction = (typeof COORDINATOR_ACTIONS)[number];

export const coordinatorOutputSchema = z
  .object({
    action: z.enum(COORDINATOR_ACTIONS),
    reason: z.string().min(1),
    params: z
      .object({
        founderCategory: z.enum(FOUNDER_DECISION_CATEGORIES).optional(),
        founderQuestion: z.string().min(1).optional(),
        spawnTitle: z.string().min(1).optional(),
        spawnTaskType: z.enum(TASK_TYPES).optional(),
        spawnRiskClass: z.enum(RISK_CLASSES).optional(),
        note: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CoordinatorOutput = z.infer<typeof coordinatorOutputSchema>;

/** Bounded snapshot handed to the Coordinator. Deliberately small. */
export interface CoordinatorSnapshot {
  task: Pick<
    Task,
    | 'id'
    | 'laneId'
    | 'title'
    | 'taskType'
    | 'state'
    | 'riskClass'
    | 'requiresPr'
    | 'prNumber'
    | 'prHeadSha'
    | 'prBaseSha'
    | 'ciStatus'
    | 'requiredResources'
  >;
  lane: Pick<Lane, 'id' | 'name' | 'riskClass' | 'maxActiveImplementationPrs' | 'status'>;
  dependencies: Array<{
    dependsOnTaskId: string;
    requiredState: string;
    actualState: string;
    satisfied: boolean;
  }>;
  policy: {
    reviewMaxRounds: number;
    stopWhenBlocker: number;
    stopWhenHigh: number;
    mergeRequiresFounder: boolean;
    stagingWriteRequiresFounder: boolean;
    productionWriteRequiresFounder: boolean;
  };
  review: {
    completedVerdictRounds: number;
    latestAttempt: Pick<
      ReviewAttempt,
      'round' | 'headSha' | 'blocker' | 'high' | 'medium' | 'low' | 'status'
    > | null;
    cleanAtCurrentHead: boolean;
  };
  founderDecisions: Array<Pick<FounderDecision, 'id' | 'category' | 'state' | 'question'>>;
  /** Authority documents the target project declares. Read-only references. */
  projectAuthorityRefs: string[];
  latestWorkerReport: unknown | null;
}

export interface Coordinator {
  readonly name: string;
  decide(snapshot: CoordinatorSnapshot): Promise<CoordinatorOutput>;
}

/** Result of validating a Coordinator action against policy + state machine. */
export interface CoordinatorValidation {
  allowed: boolean;
  reason: string;
}

export const COORDINATOR_SNAPSHOT_TASK_STATES = TASK_STATES;
