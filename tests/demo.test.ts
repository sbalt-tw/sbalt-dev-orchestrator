import { describe, expect, it } from 'vitest';
import { runDemo } from '../src/demo/scenario.js';
import { policySchema } from '../src/policy/schema.js';
import { sbaltProjectAdapterConfig, SbaltReadOnlyProjectAdapter } from '../src/projects/sbalt.js';

describe('phase-0 demo scenario', () => {
  it('walks the whole workflow on synthetic data', async () => {
    const result = await runDemo();

    // A and C proceed in parallel; B waits on A.
    expect(result.timeline.some((l) => l.includes('A=RUNNING') && l.includes('C=RUNNING'))).toBe(true);
    expect(result.timeline.some((l) => l.includes('B=WAITING_DEPENDENCY'))).toBe(true);

    // A HIGH finding sends A back, and a later clean verdict lets it through.
    expect(result.timeline.some((l) => l.includes('HIGH=1') && l.includes('A=REVIEW_FIX'))).toBe(true);
    expect(result.reviewRounds).toBe(2);

    // The Founder Gate actually blocked the merge.
    expect(result.founderGateBlockedMerge).toBe(true);

    // Final states.
    expect(result.finalStates.A).toBe('DONE');
    expect(result.finalStates.C).toBe('DONE');
    expect(result.finalStates.B).toBe('RUNNING');
  });
});

describe('project adapter boundary', () => {
  it('describes SBALT without needing or touching a checkout', () => {
    const adapter = new SbaltReadOnlyProjectAdapter(
      sbaltProjectAdapterConfig({ SBALT_REPO_PATH: '' } as NodeJS.ProcessEnv),
    );
    const described = adapter.describe();

    expect(described.repoPath).toBeNull();
    expect(described.canonicalBranch).toBe('main');
    expect(described.authorityDocs.length).toBeGreaterThan(0);
    // The adapter surface is read-only by construction: there is no method here
    // that could mutate a target project.
    expect(Object.keys(adapter)).not.toContain('write');
  });

  it('reads a repo path from the environment rather than a committed absolute path', () => {
    const config = sbaltProjectAdapterConfig({ SBALT_REPO_PATH: '/tmp/example' } as NodeJS.ProcessEnv);
    expect(config.repoPath).toBe('/tmp/example');
  });

  it('classifies a risky change higher than a docs change', () => {
    const adapter = new SbaltReadOnlyProjectAdapter();
    expect(adapter.classifyRisk({ taskType: 'DOCS' })).toBe('LOW');
    expect(adapter.classifyRisk({ taskType: 'IMPLEMENTATION', paths: ['sql/x.sql'] })).toBe('HIGH');
    expect(adapter.classifyRisk({ taskType: 'DEPLOYMENT', touchesRemoteEnvironment: true })).toBe('HIGH');
  });
});

describe('policy', () => {
  it('defaults every gate closed', () => {
    const policy = policySchema.parse({});
    expect(policy.merge.default).toBe('founderRequired');
    expect(policy.remoteWrites.staging).toBe('founderRequired');
    expect(policy.remoteWrites.production).toBe('founderRequired');
    expect(policy.destructiveOperations.founderRequired).toBe(true);
    expect(policy.selfHosting.enabled).toBe(false);
  });

  it('rejects an unknown policy key instead of ignoring it', () => {
    expect(() => policySchema.parse({ mrege: { default: 'allowed' } })).toThrow();
  });

  it('rejects self-hosting being switched on', () => {
    expect(() => policySchema.parse({ selfHosting: { enabled: true } })).toThrow();
  });
});
