/**
 * Fake project adapter used by tests and the demo scenario.
 *
 * It has no repository at all, which is the point: it proves the core
 * scheduler carries no project-specific assumptions.
 */

import type { RiskClass } from '../domain/entities.js';
import type { ProjectAdapter, ProjectDescriptor, RiskClassificationInput } from './adapter.js';

export class FakeProjectAdapter implements ProjectAdapter {
  readonly id = 'fake';

  constructor(private readonly overrides: Partial<ProjectDescriptor> = {}) {}

  describe(): ProjectDescriptor {
    return {
      id: this.id,
      displayName: 'Fake Project',
      repoPath: null,
      githubRepo: null,
      canonicalBranch: 'main',
      authorityDocs: [],
      validationCommands: ['npm test'],
      worktreeStrategy: 'none',
      ...this.overrides,
    };
  }

  classifyRisk(input: RiskClassificationInput): RiskClass {
    if (input.destructive === true || input.touchesRemoteEnvironment === true) return 'HIGH';
    if (input.taskType === 'DOCS') return 'LOW';
    return 'STANDARD';
  }
}
