/**
 * Policy schema and loader.
 *
 * Policy is configuration, not code. The parser is strict so a typo in
 * policy.yaml fails loudly at load time rather than silently disabling a gate.
 *
 * Phase-0 defaults are deliberately conservative: every remote write, every
 * destructive operation and every merge requires a Founder decision. The types
 * already carry the shape that risk-based auto-merge would need, so enabling it
 * later is a policy change rather than a scheduler rewrite.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { RISK_CLASSES } from '../domain/entities.js';

const gateSchema = z.enum(['founderRequired', 'allowed']);

export const policySchema = z
  .object({
    review: z
      .object({
        standardMaxRounds: z.number().int().positive().default(3),
        highRiskMaxRounds: z.number().int().positive().default(5),
        stopWhen: z
          .object({
            blocker: z.number().int().nonnegative().default(0),
            high: z.number().int().nonnegative().default(0),
          })
          .strict()
          .default({ blocker: 0, high: 0 }),
        /**
         * When true, a review that was killed by infrastructure does not count
         * against the round budget. This mirrors the rule the SBALT workflow
         * already runs on and is the default.
         */
        infraAbortConsumesRound: z.boolean().default(false),
      })
      .strict()
      .default({}),
    lanes: z
      .object({
        defaultMaxActiveImplementationPrs: z.number().int().positive().default(1),
      })
      .strict()
      .default({}),
    workers: z
      .object({
        maxConcurrent: z.number().int().positive().default(3),
        /** How long a worker lease stays valid without a heartbeat. */
        leaseTtlMs: z.number().int().positive().default(15 * 60 * 1000),
      })
      .strict()
      .default({}),
    remoteWrites: z
      .object({
        staging: gateSchema.default('founderRequired'),
        production: gateSchema.default('founderRequired'),
      })
      .strict()
      .default({}),
    destructiveOperations: z
      .object({
        founderRequired: z.boolean().default(true),
      })
      .strict()
      .default({}),
    merge: z
      .object({
        /** Phase 0 ships no auto-merge; the default gate is the Founder. */
        default: gateSchema.default('founderRequired'),
        /** Reserved for future risk-based auto-merge. Ignored in Phase 0. */
        byRiskClass: z.record(z.enum(RISK_CLASSES), gateSchema).default({}),
      })
      .strict()
      .default({}),
    resources: z
      .array(
        z
          .object({
            name: z.string().min(1),
            capacity: z.number().int().nonnegative(),
            founderAuthorizationRequired: z.boolean().default(false),
          })
          .strict(),
      )
      .default([
        { name: 'codex', capacity: 1, founderAuthorizationRequired: false },
        { name: 'docker-heavy', capacity: 1, founderAuthorizationRequired: false },
        { name: 'ios-simulator', capacity: 1, founderAuthorizationRequired: false },
        { name: 'repo-final-rebase', capacity: 1, founderAuthorizationRequired: false },
        { name: 'staging-write', capacity: 1, founderAuthorizationRequired: true },
        { name: 'production-write', capacity: 1, founderAuthorizationRequired: true },
      ]),
    selfHosting: z
      .object({
        enabled: z.literal(false).default(false),
      })
      .strict()
      .default({}),
  })
  .strict();

export type Policy = z.infer<typeof policySchema>;

export const DEFAULT_POLICY: Policy = policySchema.parse({});

export class PolicyLoadError extends Error {}

export function parsePolicy(raw: unknown): Policy {
  const result = policySchema.safeParse(raw ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new PolicyLoadError(`invalid policy: ${issues}`);
  }
  return result.data;
}

/**
 * Load policy from an explicit path, DEV_ORCH_POLICY_PATH, config/policy.yaml,
 * or config/policy.example.yaml — the first that exists. Falls back to defaults
 * when none is present.
 */
export function loadPolicy(explicitPath?: string): Policy {
  const candidates = [
    explicitPath,
    process.env.DEV_ORCH_POLICY_PATH,
    'config/policy.yaml',
    'config/policy.example.yaml',
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  for (const candidate of candidates) {
    const full = resolve(candidate);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, 'utf8');
    return parsePolicy(parseYaml(text));
  }
  return DEFAULT_POLICY;
}
