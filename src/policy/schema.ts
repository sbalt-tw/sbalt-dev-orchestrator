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
import { FOUNDER_DECISION_CATEGORIES, RISK_CLASSES } from '../domain/entities.js';
import type { FounderDecisionCategory } from '../domain/entities.js';

/**
 * Resources whose gating is fixed by name.
 *
 * Relying on a config author to set `founderAuthorizationRequired` on
 * `production-write` means one forgotten line removes the production gate.
 * These names always carry their category.
 */
export const REMOTE_WRITE_RESOURCE_CATEGORIES: Readonly<Record<string, FounderDecisionCategory>> = {
  'staging-write': 'staging_write',
  'production-write': 'production_write',
};

/**
 * Phase-0 gates are not configurable.
 *
 * A gate that configuration can switch off is not a gate. The literal type
 * means a policy file cannot make merge, staging or production writes proceed
 * without a Founder decision, and the parser rejects the attempt loudly rather
 * than quietly honouring it. The wider union is reserved for a future phase
 * that deliberately introduces risk-based automation.
 */
const phase0GateSchema = z.literal('founderRequired');

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
        staging: phase0GateSchema.default('founderRequired'),
        production: phase0GateSchema.default('founderRequired'),
      })
      .strict()
      .default({}),
    destructiveOperations: z
      .object({
        founderRequired: z.literal(true).default(true),
      })
      .strict()
      .default({}),
    merge: z
      .object({
        /** Phase 0 ships no auto-merge, and configuration cannot introduce it. */
        default: phase0GateSchema.default('founderRequired'),
        /**
         * Reserved for future risk-based automation. Constrained to the same
         * literal in Phase 0 so it cannot be mistaken for a working override.
         */
        byRiskClass: z.record(z.enum(RISK_CLASSES), phase0GateSchema).default({}),
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
            /** Which decision authorises the resource. Required when gated. */
            founderCategory: z.enum(FOUNDER_DECISION_CATEGORIES).nullable().default(null),
          })
          .strict()
          .superRefine((resource, ctx) => {
            // A gated resource with no category has nothing to check and would
            // lease itself; a category without the flag reads as protection
            // that is not applied. Both are rejected.
            if (resource.founderAuthorizationRequired && resource.founderCategory === null) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `resource '${resource.name}' is founder-gated but declares no founderCategory`,
              });
            }
            if (!resource.founderAuthorizationRequired && resource.founderCategory !== null) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `resource '${resource.name}' declares founderCategory but is not founder-gated`,
              });
            }
            // The remote-write resources are gated by identity, not by trust in
            // the config author remembering the flag.
            const forced = REMOTE_WRITE_RESOURCE_CATEGORIES[resource.name];
            if (forced && (!resource.founderAuthorizationRequired || resource.founderCategory !== forced)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `resource '${resource.name}' must be founder-gated with founderCategory '${forced}'`,
              });
            }
          }),
      )
      .default([
        { name: 'codex', capacity: 1, founderAuthorizationRequired: false, founderCategory: null },
        { name: 'docker-heavy', capacity: 1, founderAuthorizationRequired: false, founderCategory: null },
        { name: 'ios-simulator', capacity: 1, founderAuthorizationRequired: false, founderCategory: null },
        { name: 'repo-final-rebase', capacity: 1, founderAuthorizationRequired: false, founderCategory: null },
        { name: 'staging-write', capacity: 1, founderAuthorizationRequired: true, founderCategory: 'staging_write' },
        { name: 'production-write', capacity: 1, founderAuthorizationRequired: true, founderCategory: 'production_write' },
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
