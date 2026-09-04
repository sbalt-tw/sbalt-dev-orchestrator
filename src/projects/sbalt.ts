/**
 * SBALT project adapter — configuration only.
 *
 * This describes how a future adapter would see the SBALT repository. It reads
 * SBALT_REPO_PATH from the environment and exposes it as a descriptor. It does
 * not open the repository, run any command in it, or write to it, and it has no
 * method that could. Phase 0 must not touch SBALT.
 *
 * The committed configuration carries no absolute developer path; the operator
 * supplies one through the environment.
 */

import type { RiskClass } from '../domain/entities.js';
import type { ProjectAdapter, ProjectDescriptor, RiskClassificationInput } from './adapter.js';

export interface SbaltProjectAdapterConfig {
  repoPath: string | null;
  githubRepo: string;
  canonicalBranch: string;
  authorityDocs: string[];
  validationCommands: string[];
  worktreeStrategy: ProjectDescriptor['worktreeStrategy'];
}

export function sbaltProjectAdapterConfig(
  env: NodeJS.ProcessEnv = process.env,
): SbaltProjectAdapterConfig {
  const repoPath = env.SBALT_REPO_PATH?.trim();
  return {
    repoPath: repoPath && repoPath.length > 0 ? repoPath : null,
    githubRepo: 'sbalt-tw/SBALT',
    canonicalBranch: 'main',
    authorityDocs: [
      '.claude/CLAUDE.md',
      'docs/ai/current-operating-context.md',
      'docs/ai/ai-os-index.md',
      'sql/APPLY_ORDER.md',
    ],
    validationCommands: ['npx tsc --noEmit', 'npm run lint', 'npm test'],
    worktreeStrategy: 'per-task-worktree',
  };
}

/**
 * Read-only descriptor adapter. Deliberately has no mutation surface.
 */
export class SbaltReadOnlyProjectAdapter implements ProjectAdapter {
  readonly id = 'sbalt';

  constructor(private readonly config: SbaltProjectAdapterConfig = sbaltProjectAdapterConfig()) {}

  describe(): ProjectDescriptor {
    return {
      id: this.id,
      displayName: 'SBALT',
      repoPath: this.config.repoPath,
      githubRepo: this.config.githubRepo,
      canonicalBranch: this.config.canonicalBranch,
      authorityDocs: [...this.config.authorityDocs],
      validationCommands: [...this.config.validationCommands],
      worktreeStrategy: this.config.worktreeStrategy,
    };
  }

  classifyRisk(input: RiskClassificationInput): RiskClass {
    if (input.destructive === true || input.touchesRemoteEnvironment === true) return 'HIGH';
    const paths = input.paths ?? [];
    if (paths.some((p) => p.startsWith('sql/'))) return 'HIGH';
    if (input.taskType === 'DOCS') return 'LOW';
    return 'STANDARD';
  }
}
