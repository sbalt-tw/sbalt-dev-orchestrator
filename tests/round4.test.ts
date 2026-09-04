/**
 * Round-4 regressions.
 *
 * Three criticals and six highs, each with the test that would have caught it.
 * The theme running through them is the same one that produced the earlier
 * rounds: a system that treats absence as consent. A missing outcome read as
 * approval, a legacy row read as approval, a CHECK that passes when a value is
 * NULL, a stale lease still counted as authority. Each is now explicit.
 */

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/state/schema.js';
import { Store } from '../src/state/store.js';
import { Orchestrator } from '../src/orchestrator.js';
import { checkGate, continuationFor } from '../src/policy/founderGate.js';
import { cleanAtCurrentHead } from '../src/policy/review.js';
import { policySchema } from '../src/policy/schema.js';
import {
  addWorkers,
  baseReport,
  cleanupTempDirs,
  FakeClock,
  makeHarness,
  registerReviewer,
  testPolicy,
  tmpDbPath,
  SHA_A,
  SHA_BASE,
} from './helpers.js';

afterAll(cleanupTempDirs);

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A database at exactly the schema the previous reviewed head shipped. */
function makeV2Database(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-orch-v2-'));
  dirs.push(dir);
  const path = join(dir, 'v2.sqlite');
  const db = new Database(path);
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);`);
  const now = '2026-02-01T00:00:00.000Z';
  for (const m of MIGRATIONS.filter((x) => x.version <= 2)) {
    if (m.rebuildsTables) {
      db.pragma('foreign_keys = OFF');
      db.pragma('legacy_alter_table = ON');
    }
    db.exec(m.sql);
    if (m.rebuildsTables) {
      db.pragma('legacy_alter_table = OFF');
      db.pragma('foreign_keys = ON');
    }
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)').run(m.version, m.name, now);
  }
  db.prepare('INSERT INTO projects (id, name, adapter_id, created_at) VALUES (?,?,?,?)').run('prj_1', 'p', 'fake', now);
  db.prepare(
    'INSERT INTO lanes (id, project_id, name, risk_class, max_active_implementation_prs, status, created_at) VALUES (?,?,?,?,?,?,?)',
  ).run('lane_1', 'prj_1', 'core', 'STANDARD', 1, 'ACTIVE', now);
  db.prepare(
    `INSERT INTO tasks (id, lane_id, title, task_type, state, risk_class, priority, requires_pr,
       required_resources, required_capabilities, ci_status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run('task_1', 'lane_1', 'legacy', 'IMPLEMENTATION', 'READY_TO_MERGE', 'STANDARD', 0, 1, '[]', '[]', 'PASSED', now, now);
  // A v2 decision: resolved, with no record of what was decided.
  db.prepare(
    `INSERT INTO founder_decisions (id, task_id, category, question, state, resolution, resolved_target, provenance, created_at, resolved_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run('fd_v2', 'task_1', 'merge', 'merge?', 'RESOLVED', 'DENIED BY FOUNDER', 'READY', 'operator', now, now);
  // A v2 gated resource that migration 2 mislabelled.
  db.prepare('INSERT INTO resources (name, capacity, founder_required, founder_category) VALUES (?,?,?,?)').run(
    'legacy-danger',
    1,
    1,
    'production_write',
  );
  db.close();
  return path;
}

describe('CRITICAL — an omitted outcome is not an approval', () => {
  it('requires the caller to say what was decided', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 't', taskType: 'IMPLEMENTATION' });
    const id = h.orch.requireFounderDecision(task.id, 'production_write', 'deploy?');

    // A refusal recorded as a refusal blocks the work it refuses.
    h.orch.resolveFounderDecision(id, 'no, not this one', 'DENIED');

    expect(h.orch.store.getFounderDecision(id)?.outcome).toBe('DENIED');
    expect(h.orch.store.requireTask(task.id).state).toBe('BLOCKED_POLICY');
    const gate = checkGate(h.orch.store, h.orch.policy, h.orch.store.requireTask(task.id), 'production_write');
    expect(gate.satisfied).toBe(false);
    h.orch.close();
  });

  it('refuses to mark a decision resolved without an outcome', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 't', taskType: 'IMPLEMENTATION' });
    const decision = h.orch.store.createFounderDecision({
      taskId: task.id,
      category: 'merge',
      question: 'merge?',
      provenance: 'test',
    });
    expect(() => h.orch.store.setFounderDecisionState(decision.id, 'RESOLVED', 'yes')).toThrow();
    h.orch.close();
  });

  it('refuses a RESOLVED row with a null outcome at the database boundary', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 't', taskType: 'IMPLEMENTATION' });
    const decision = h.orch.store.createFounderDecision({
      taskId: task.id,
      category: 'merge',
      question: 'merge?',
      provenance: 'test',
    });
    // `outcome IN (...)` against NULL evaluates to NULL, and SQLite accepts a
    // CHECK that evaluates to NULL. The constraint says IS NOT NULL for exactly
    // that reason.
    expect(() =>
      h.orch.store.db
        .prepare("UPDATE founder_decisions SET state = 'RESOLVED', outcome = NULL WHERE id = ?")
        .run(decision.id),
    ).toThrow();
    h.orch.close();
  });
});

describe('CRITICAL — a legacy resolution is not consent', () => {
  it('upgrades a v2 database and withdraws its unrecorded decisions', () => {
    const path = makeV2Database();
    const store = new Store({ dbPath: path });

    const versions = store.db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);

    // The row said "DENIED BY FOUNDER" in its text while being stored the same
    // way an approval was. It authorises nothing now.
    const legacy = store.getFounderDecision('fd_v2');
    expect(legacy?.state).toBe('WITHDRAWN');
    expect(legacy?.outcome).toBeNull();
    store.close();
  });

  it('does not let a withdrawn legacy decision open the merge gate', () => {
    const path = makeV2Database();
    const orch = new Orchestrator({ dbPath: path, policy: testPolicy() });
    const gate = checkGate(orch.store, orch.policy, orch.store.requireTask('task_1'), 'merge');
    expect(gate.satisfied).toBe(false);
    const merged = orch.engine.apply({ taskId: 'task_1', event: 'MERGED', actor: 'test' });
    expect(merged.ok).toBe(false);
    orch.close();
  });

  it('recategorises a resource that migration 2 mislabelled as production_write', () => {
    const path = makeV2Database();
    const store = new Store({ dbPath: path });
    expect(store.getResource('legacy-danger')?.founderCategory).toBe('legacy_unknown');
    store.close();
  });
});

describe('HIGH — a late blocking verdict takes back merge readiness', () => {
  it('sends a merge-ready task back for rework and blocks the merge', () => {
    const h = makeHarness();
    registerReviewer(h, 'wk_reviewer');
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'clean then not',
      taskType: 'IMPLEMENTATION',
      initialState: 'WAITING_REVIEW',
    });
    h.orch.store.updateTaskFields(task.id, { prNumber: 1, prBaseSha: SHA_BASE, prHeadSha: SHA_A });

    const verdict = (blocker: number, high: number) => ({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: 'wk_reviewer' }),
      review: {
        reviewer: 'codex',
        round: 1,
        baseSha: SHA_BASE,
        headSha: SHA_A,
        blocker,
        high,
        medium: 0,
        low: 0,
        status: 'COMPLETED_VERDICT' as const,
      },
    });

    h.orch.submitReport(verdict(0, 0));
    expect(h.orch.store.requireTask(task.id).state).toBe('READY_TO_MERGE');

    // A second reviewer finds a HIGH at the same commit.
    const late = h.orch.submitReport(verdict(0, 1));

    expect(late.accepted).toBe(true);
    expect(h.orch.store.requireTask(task.id).state).toBe('REVIEW_FIX');
    // The earlier all-clear no longer stands at this head.
    expect(
      cleanAtCurrentHead(h.orch.store.requireTask(task.id), h.orch.store.listReviewAttempts(task.id), h.orch.policy),
    ).toBe(false);
    h.orch.close();
  });

  it('rolls back an accepted report whose transition was refused', () => {
    const h = makeHarness();
    registerReviewer(h, 'wk_reviewer');
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'wrong state for this report',
      taskType: 'IMPLEMENTATION',
      initialState: 'QUEUED',
    });
    h.orch.store.updateTaskFields(task.id, { prNumber: 1, prBaseSha: SHA_BASE, prHeadSha: SHA_A });

    const result = h.orch.submitReport({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: 'wk_reviewer' }),
      review: {
        reviewer: 'codex',
        round: 1,
        baseSha: SHA_BASE,
        headSha: SHA_A,
        blocker: 0,
        high: 0,
        medium: 0,
        low: 0,
        status: 'COMPLETED_VERDICT',
      },
    });

    expect(result.accepted).toBe(false);
    // Nothing persisted: no review attempt, no accepted audit row.
    expect(h.orch.store.listReviewAttempts(task.id)).toHaveLength(0);
    expect(h.orch.store.latestWorkerReport(task.id)).toBeNull();
    expect(h.orch.store.requireTask(task.id).state).toBe('QUEUED');
    h.orch.close();
  });
});

describe('HIGH — a gate answered during an outage still applies', () => {
  it('carries the decision through recovery instead of stranding the task', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 'answered while down', taskType: 'IMPLEMENTATION' });
    const id = h.orch.requireFounderDecision(task.id, 'architecture_change', 'change?');
    expect(h.orch.store.requireTask(task.id).state).toBe('FOUNDER_DECISION');

    h.orch.engine.apply({ taskId: task.id, event: 'INFRA_FAILURE', actor: 'test' });
    // The Founder answers while the task is blocked.
    h.orch.resolveFounderDecision(id, 'go ahead', 'APPROVED');

    const recovered = h.orch.engine.apply({ taskId: task.id, event: 'RECOVERED', actor: 'test' });

    expect(recovered.ok).toBe(true);
    // Not stranded back at a gate with nothing left to answer.
    expect(h.orch.store.requireTask(task.id).state).toBe('READY');
    h.orch.close();
  });

  it('honours a refusal answered during an outage', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 'refused while down', taskType: 'IMPLEMENTATION' });
    const id = h.orch.requireFounderDecision(task.id, 'production_write', 'deploy?');
    h.orch.engine.apply({ taskId: task.id, event: 'INFRA_FAILURE', actor: 'test' });
    h.orch.resolveFounderDecision(id, 'no', 'DENIED');

    h.orch.engine.apply({ taskId: task.id, event: 'RECOVERED', actor: 'test' });

    expect(h.orch.store.requireTask(task.id).state).toBe('BLOCKED_POLICY');
    h.orch.close();
  });
});

describe('HIGH — an old answer does not decide a new question', () => {
  it('lets a later merge approval reach READY_TO_MERGE after an earlier architecture approval', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 'two waits', taskType: 'IMPLEMENTATION' });

    const arch = h.orch.requireFounderDecision(task.id, 'architecture_change', 'shape?');
    h.orch.resolveFounderDecision(arch, 'yes', 'APPROVED');
    expect(h.orch.store.requireTask(task.id).state).toBe('READY');

    // A separate, later wait.
    const merge = h.orch.requireFounderDecision(task.id, 'merge', 'merge?');
    h.orch.resolveFounderDecision(merge, 'yes', 'APPROVED');

    expect(h.orch.store.requireTask(task.id).state).toBe('READY_TO_MERGE');
    h.orch.close();
  });

  it('does not let a past budget extension route every future approval to rework', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 'budget then merge', taskType: 'IMPLEMENTATION' });

    const budget = h.orch.requireFounderDecision(task.id, 'review_budget_extension', 'more rounds?');
    h.orch.resolveFounderDecision(budget, 'yes', 'APPROVED');
    expect(h.orch.store.requireTask(task.id).state).toBe('REVIEW_FIX');

    const merge = h.orch.requireFounderDecision(task.id, 'merge', 'merge?');
    h.orch.resolveFounderDecision(merge, 'yes', 'APPROVED');

    expect(h.orch.store.requireTask(task.id).state).toBe('READY_TO_MERGE');
    h.orch.close();
  });

  it('lets a fresh request supersede an earlier refusal of the same category', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 'asked twice', taskType: 'IMPLEMENTATION' });

    const first = h.orch.requireFounderDecision(task.id, 'production_write', 'deploy?');
    h.orch.resolveFounderDecision(first, 'no', 'DENIED');
    expect(checkGate(h.orch.store, h.orch.policy, h.orch.store.requireTask(task.id), 'production_write').satisfied).toBe(false);

    const second = h.orch.requireFounderDecision(task.id, 'production_write', 'deploy now?');
    h.orch.resolveFounderDecision(second, 'yes', 'APPROVED');

    expect(checkGate(h.orch.store, h.orch.policy, h.orch.store.requireTask(task.id), 'production_write').satisfied).toBe(true);
    h.orch.close();
  });

  it('keeps a denial winning within one wait, whatever order answers arrive', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({ laneId: h.laneId, title: 'same wait', taskType: 'IMPLEMENTATION' });
    const a = h.orch.requireFounderDecision(task.id, 'architecture_change', 'a?');
    const b = h.orch.requireFounderDecision(task.id, 'product_semantics_change', 'b?');
    // Both belong to the same wait.
    expect(h.orch.store.getFounderDecision(a)?.episode).toBe(h.orch.store.getFounderDecision(b)?.episode);

    h.orch.resolveFounderDecision(a, 'yes', 'APPROVED');
    h.orch.resolveFounderDecision(b, 'no', 'DENIED');

    expect(h.orch.store.requireTask(task.id).state).toBe('BLOCKED_POLICY');
    h.orch.close();
  });

  it('refuses to continue on a resolved decision with no recorded outcome', () => {
    // Defensive: the database forbids this row, so the check is belt and braces.
    const verdict = continuationFor([
      {
        id: 'fd_x',
        taskId: 't',
        category: 'merge',
        question: 'q',
        state: 'RESOLVED',
        outcome: null,
        episode: 1,
        resolution: null,
        resolvedTarget: null,
        provenance: 'test',
        createdAt: '',
        resolvedAt: null,
      },
    ]);
    expect(verdict.target).toBe('BLOCKED_POLICY');
  });
});

describe('HIGH — a legacy gate survives initialisation', () => {
  it('does not let a policy sync turn a legacy_unknown resource ungated', () => {
    const path = makeV2Database();
    // A policy that describes the same resource as an ordinary ungated one.
    const policy = policySchema.parse({
      resources: [
        { name: 'legacy-danger', capacity: 1 },
        { name: 'staging-write', capacity: 1, founderAuthorizationRequired: true, founderCategory: 'staging_write' },
        { name: 'production-write', capacity: 1, founderAuthorizationRequired: true, founderCategory: 'production_write' },
      ],
    });
    const orch = new Orchestrator({ dbPath: path, policy });
    orch.init();

    const resource = orch.store.getResource('legacy-danger');
    expect(resource?.founderAuthorizationRequired).toBe(true);
    expect(resource?.founderCategory).toBe('legacy_unknown');

    const task = orch.store.createTask({
      laneId: 'lane_1',
      title: 'wants it',
      taskType: 'DEPLOYMENT',
      requiresPr: false,
      requiredResources: ['legacy-danger'],
    });
    const acquired = orch.resources.acquire({ resourceName: 'legacy-danger', task: orch.store.requireTask(task.id) });
    expect(acquired.ok).toBe(false);
    orch.close();
  });
});

describe('HIGH — an expired lease is not authority', () => {
  it('refuses an outcome report once the lease has run out', () => {
    const clock = new FakeClock();
    const h = makeHarness({
      policy: testPolicy({ workers: { maxConcurrent: 2, leaseTtlMs: 60_000 } }),
      dbPath: tmpDbPath(),
      clock,
    });
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'lease runs out',
      taskType: 'DOCS',
      requiresPr: false,
    });
    h.orch.tick();
    const lease = h.orch.store.getActiveWorkerLeaseForTask(task.id);
    expect(lease).not.toBeNull();

    // Past the TTL, but before any tick has reconciled it.
    clock.advance(120_000);

    const result = h.orch.submitReport({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: lease?.workerId ?? 'x' }),
      status: 'COMPLETED',
    });

    expect(result.accepted).toBe(false);
    expect(h.orch.store.requireTask(task.id).state).toBe('RUNNING');
    // The lease is still there for reconciliation to find and record.
    expect(h.orch.store.getActiveWorkerLeaseForTask(task.id)).not.toBeNull();

    // And reconciliation does exactly that.
    const ticked = h.orch.tick();
    expect(ticked.reconcile.staleLeases).toBe(1);
    expect(h.orch.store.requireTask(task.id).state).toBe('BLOCKED_INFRA');
    h.orch.close();
  });

  it('still accepts a report from a lease that is within its term', () => {
    const clock = new FakeClock();
    const h = makeHarness({
      policy: testPolicy({ workers: { maxConcurrent: 2, leaseTtlMs: 60_000 } }),
      dbPath: tmpDbPath(),
      clock,
    });
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'in time',
      taskType: 'DOCS',
      requiresPr: false,
    });
    h.orch.tick();
    const lease = h.orch.store.getActiveWorkerLeaseForTask(task.id);
    clock.advance(30_000);

    const result = h.orch.submitReport({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: lease?.workerId ?? 'x' }),
      status: 'COMPLETED',
    });

    expect(result.accepted).toBe(true);
    expect(h.orch.store.requireTask(task.id).state).toBe('DONE');
    h.orch.close();
  });
});
