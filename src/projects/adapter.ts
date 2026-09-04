/**
 * Project adapter boundary.
 *
 * The core orchestrator knows nothing about any specific repository. Everything
 * project-shaped — where the checkout is, what the canonical branch is called,
 * which documents carry authority, which commands validate a change — arrives
 * through this interface.
 *
 * Phase 0 is strictly read-only. There is no method here that mutates a target
 * project, by design: the orchestrator must be able to reason about SBALT long
 * before it is allowed to touch it.
 */

import type { RiskClass, TaskType } from '../domain/entities.js';

export interface ProjectDescriptor {
  id: string;
  displayName: string;
  /** Local checkout path, when one is configured. Never written to in Phase 0. */
  repoPath: string | null;
  /** e.g. "org/repo". Null when no remote is configured. */
  githubRepo: string | null;
  canonicalBranch: string;
  /** Documents that carry decision authority for this project. */
  authorityDocs: string[];
  /** Commands a worker would run to validate a change. Not executed in Phase 0. */
  validationCommands: string[];
  /** How this project prefers isolated checkouts. Informational in Phase 0. */
  worktreeStrategy: 'none' | 'per-task-worktree';
}

export interface RiskClassificationInput {
  taskType: TaskType;
  /** Paths the task is expected to touch, when known. */
  paths?: string[];
  touchesRemoteEnvironment?: boolean;
  destructive?: boolean;
}

export interface ProjectAdapter {
  readonly id: string;
  describe(): ProjectDescriptor;
  /** A hint, not an authority: policy still decides what is gated. */
  classifyRisk(input: RiskClassificationInput): RiskClass;
}
