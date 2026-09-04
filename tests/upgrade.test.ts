/**
 * Round-3 regressions.
 *
 * The three blockers and three highs raised against the previous head, each
 * with a test that would have caught it. The migration case in particular is
 * here because the whole suite passed while every populated database would have
 * failed to open: testing only fresh databases proved nothing about upgrades.
 */

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/state/schema.js';
import { Orchestrator } from '../src/orchestrator.js';
import { Store } from '../src/state/store.js';
import { policySchema, defaultPolicy, deepFreeze } from '../src/policy/schema.js';
import { checkGate } from '../src/policy/founderGate.js';
import {
  addWorkers,
  baseReport,
  cleanupTempDirs,
  makeHarness,
  registerReviewer,
  testPolicy,
  SHA_A,
  SHA_BASE,
} from './helpers.js';

afterAll(cleanupTempDirs);

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Build a database at schema version 1 only, populated across every foreign-key
 * relationship the rebuild has to preserve.
 */
function makePopulatedV1(): { path: string; counts: Record<string, number> } {
  const dir = mkdtempSync(join(tmpdir(), 'dev-orch-v1-'));
  dirs.push(dir);
  const path = join(dir, 'v1.sqlite');
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);`);
  const first = MIGRATIONS[0];
  if (!first) throw new Error('no migration 1');
  db.exec(first.sql);
  db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
    first.version,
    first.name,
    '2026-01-01T00:00:00.000Z',
  );

  const now = '2026-01-01T00:00:00.000Z';
  db.prepare('INSERT INTO projects (id, name, adapter_id, created_at) VALUES (?,?,?,?)').run('prj_1', 'legacy', 'fake', now);
  db.prepare(
    'INSERT INTO lanes (id, project_id, name, risk_class, max_active_implementation_prs, status, created_at) VALUES (?,?,?,?,?,?,?)',
  ).run('lane_1', 'prj_1', 'core', 'HIGH', 1, 'ACTIVE', now);
  for (const [id, state] of [
    ['task_1', 'RUNNING'],
    ['task_2', 'WAITING_REVIEW'],
    ['task_3', 'DONE'],
  ] as const) {
    db.prepare(
      `INSERT INTO tasks (id, lane_id, title, task_type, state, risk_class, priority, requires_pr,
        required_resources, required_capabilities, ci_status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, 'lane_1', `legacy ${id}`, 'IMPLEMENTATION', state, 'STANDARD', 0, 1, '[]', '[]', 'NONE', now, now);
  }
  db.prepare('INSERT INTO task_dependencies (task_id, depends_on_task_id, required_state) VALUES (?,?,?)').run(
    'task_2',
    'task_1',
    'DONE',
  );
  db.prepare(
    'INSERT INTO workers (id, provider, capabilities, status, created_at, last_seen_at) VALUES (?,?,?,?,?,?)',
  ).run('wk_1', 'fake', '["implementation"]', 'BUSY', now, now);
  db.prepare(
    'INSERT INTO worker_leases (id, task_id, worker_id, started_at, heartbeat_at, expires_at, status) VALUES (?,?,?,?,?,?,?)',
  ).run('wl_1', 'task_1', 'wk_1', now, now, '2026-01-01T00:15:00.000Z', 'ACTIVE');
  db.prepare('INSERT INTO resources (name, capacity, founder_required) VALUES (?,?,?)').run('codex', 1, 0);
  db.prepare('INSERT INTO resources (name, capacity, founder_required) VALUES (?,?,?)').run('production-write', 1, 1);
  // A gated resource whose meaning the v1 schema never recorded.
  db.prepare('INSERT INTO resources (name, capacity, founder_required) VALUES (?,?,?)').run('legacy-danger', 1, 1);
  db.prepare(
    'INSERT INTO resource_leases (id, resource_name, task_id, worker_id, acquired_at, expires_at, status) VALUES (?,?,?,?,?,?,?)',
  ).run('rl_1', 'codex', 'task_1', 'wk_1', now, null, 'ACTIVE');
  db.prepare(
    `INSERT INTO review_attempts (id, task_id, reviewer, round, base_sha, head_sha, blocker, high, medium, low, status, created_at, completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run('rev_1', 'task_2', 'codex', 1, SHA_BASE, SHA_A, 0, 1, 0, 0, 'COMPLETED_VERDICT', now, now);
  db.prepare(
    `INSERT INTO founder_decisions (id, task_id, category, question, state, resolution, provenance, created_at, resolved_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run('fd_1', 'task_3', 'merge', 'merge it?', 'RESOLVED', 'approved', 'operator', now, now);
  db.prepare(
    `INSERT INTO founder_decisions (id, task_id, category, question, state, resolution, provenance, created_at, resolved_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run('fd_2', 'task_2', 'architecture_change', 'change?', 'REQUIRED', null, 'operator', now, null);
  db.prepare(
    'INSERT INTO events (id, task_id, event_type, actor, from_state, to_state, payload, created_at, seq) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run('ev_1', 'task_1', 'WORKER_ASSIGNED', 'scheduler', 'READY', 'RUNNING', '{}', now, 1);
  db.prepare(
    'INSERT INTO worker_reports (id, task_id, worker_id, accepted, reason, payload, created_at) VALUES (?,?,?,?,?,?,?)',
  ).run('rep_1', 'task_1', 'wk_1', 1, null, '{}', now);

  const counts = {
    projects: 1,
    lanes: 1,
    tasks: 3,
    task_dependencies: 1,
    workers: 1,
    worker_leases: 1,
    resources: 3,
    resource_leases: 1,
    review_attempts: 1,
    founder_decisions: 2,
    events: 1,
    worker_reports: 1,
  };
  db.close();
  return { path, counts };
}

describe('BLOCKER 1 — a populated v1 database upgrades', () => {
  it('migrates without losing a row or breaking a reference', () => {
    const { path, counts } = makePopulatedV1();

    // Opening runs the pending migrations. This threw before the fix.
    const store = new Store({ dbPath: path });

    const versions = store.db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);

    for (const [table, expected] of Object.entries(counts)) {
      const row = store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      expect({ table, n: row.n }).toEqual({ table, n: expected });
    }

    const violations = store.db.pragma('foreign_key_check') as unknown[];
    expect(violations).toHaveLength(0);

    // The constraints from migration 2 are live on the upgraded database.
    expect(() =>
      store.db.prepare('UPDATE tasks SET state = ? WHERE id = ?').run('NOPE', 'task_1'),
    ).toThrow();

    // Relationships survived.
    expect(store.getTask('task_1')?.state).toBe('RUNNING');
    expect(store.listDependencies('task_2')).toHaveLength(1);
    expect(store.getActiveWorkerLeaseForTask('task_1')?.workerId).toBe('wk_1');
    store.close();
  });

  it('reopens and remains usable as an orchestrator after the upgrade', () => {
    const { path } = makePopulatedV1();
    const first = new Store({ dbPath: path });
    first.close();

    const orch = new Orchestrator({ dbPath: path, policy: testPolicy() });
    orch.init();
    expect(orch.store.requireTask('task_2').state).toBe('WAITING_REVIEW');
    const tickResult = orch.tick();
    expect(tickResult).toBeDefined();
    orch.close();
  });

  it('leaves the database untouched when a migration fails', () => {
    const { path, counts } = makePopulatedV1();
    const db = new Database(path);
    // A row the version-2 CHECK will refuse.
    db.prepare('UPDATE tasks SET state = ? WHERE id = ?').run('IMPOSSIBLE', 'task_1');
    db.close();

    expect(() => new Store({ dbPath: path })).toThrow();

    const after = new Database(path);
    const versions = after.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
    // Version 2 rolled back; the database is still at 1 with its data intact.
    expect(versions.map((v) => v.version)).toEqual([1]);
    const tasks = after.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number };
    expect(tasks.n).toBe(counts.tasks);
    after.close();
  });
});

describe('HIGH 4 — a legacy gated resource fails closed', () => {
  it('does not invent a category for a gated resource the old schema never described', () => {
    const { path } = makePopulatedV1();
    const store = new Store({ dbPath: path });

    // The two names whose meaning is fixed are mapped.
    expect(store.getResource('production-write')?.founderCategory).toBe('production_write');
    // Anything else keeps its uncertainty instead of being guessed at.
    expect(store.getResource('legacy-danger')?.founderCategory).toBe('legacy_unknown');
    expect(store.getResource('legacy-danger')?.founderAuthorizationRequired).toBe(true);
    store.close();
  });

  it('refuses to lease a legacy_unknown resource even with a production approval', () => {
    const { path } = makePopulatedV1();
    const orch = new Orchestrator({ dbPath: path, policy: testPolicy() });
    // init() must not overwrite the legacy row with a policy default.
    const task = orch.store.createTask({
      laneId: 'lane_1',
      title: 'wants the legacy resource',
      taskType: 'DEPLOYMENT',
      requiresPr: false,
      requiredResources: ['legacy-danger'],
    });
    // Even a resolved production_write approval must not open it.
    const decision = orch.store.createFounderDecision({
      taskId: task.id,
      category: 'production_write',
      question: 'deploy?',
      provenance: 'test',
    });
    orch.store.setFounderDecisionState(decision.id, 'RESOLVED', 'approved', 'READY', 'APPROVED');

    const outcome = orch.resources.acquire({ resourceName: 'legacy-danger', task: orch.store.requireTask(task.id) });

    expect(outcome.ok).toBe(false);
    orch.close();
  });

  it('migrates a legacy resolution to WITHDRAWN rather than inventing consent', () => {
    const { path } = makePopulatedV1();
    const store = new Store({ dbPath: path });

    // The v1 row recorded only that it was RESOLVED — never what was decided.
    // Reading that as approval would manufacture authority nobody granted, so
    // it is withdrawn and must be asked again.
    const legacy = store.getFounderDecision('fd_1');
    expect(legacy?.state).toBe('WITHDRAWN');
    expect(legacy?.outcome).toBeNull();

    // An unanswered decision survives as an unanswered decision.
    expect(store.getFounderDecision('fd_2')?.state).toBe('REQUIRED');
    expect(store.getFounderDecision('fd_2')?.outcome).toBeNull();
    store.close();
  });

  it('does not let a withdrawn legacy decision authorise anything', () => {
    const { path } = makePopulatedV1();
    const orch = new Orchestrator({ dbPath: path, policy: testPolicy() });
    const task = orch.store.requireTask('task_3');
    const gate = checkGate(orch.store, orch.policy, task, 'merge');
    expect(gate.satisfied).toBe(false);
    orch.close();
  });
});

describe('BLOCKER 2 — recovery does not erase a founder gate', () => {
  it('returns a task interrupted at the gate to the gate', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'gated then interrupted',
      taskType: 'IMPLEMENTATION',
    });
    h.orch.requireFounderDecision(task.id, 'production_write', 'deploy?');
    expect(h.orch.store.requireTask(task.id).state).toBe('FOUNDER_DECISION');

    h.orch.engine.apply({ taskId: task.id, event: 'INFRA_FAILURE', actor: 'test' });
    expect(h.orch.store.requireTask(task.id).state).toBe('BLOCKED_INFRA');

    const recovered = h.orch.engine.apply({ taskId: task.id, event: 'RECOVERED', actor: 'test' });

    expect(recovered.ok).toBe(true);
    expect(h.orch.store.requireTask(task.id).state).toBe('FOUNDER_DECISION');
    h.orch.close();
  });

  it('will not dispatch a task that still owes a decision, whatever state it is in', () => {
    const h = makeHarness();
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'gated but READY',
      taskType: 'DOCS',
      requiresPr: false,
      initialState: 'READY',
    });
    // A decision exists but the task was forced to READY by some other route.
    h.orch.store.createFounderDecision({
      taskId: task.id,
      category: 'production_write',
      question: 'deploy?',
      provenance: 'test',
    });

    const result = h.orch.tick();

    expect(result.dispatched).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason.includes('outstanding'))).toBe(true);
    expect(h.orch.store.requireTask(task.id).state).toBe('READY');
    h.orch.close();
  });

  it('lets recovery proceed normally when nothing is outstanding', () => {
    const h = makeHarness();
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'plain interruption',
      taskType: 'IMPLEMENTATION',
      initialState: 'WAITING_REVIEW',
    });
    h.orch.engine.apply({ taskId: task.id, event: 'INFRA_FAILURE', actor: 'test' });
    const recovered = h.orch.engine.apply({ taskId: task.id, event: 'RECOVERED', actor: 'test' });
    expect(recovered.ok).toBe(true);
    expect(h.orch.store.requireTask(task.id).state).toBe('WAITING_REVIEW');
    h.orch.close();
  });
});

describe('BLOCKER 3 — multiple founder decisions', () => {
  function gatedTask(h: ReturnType<typeof makeHarness>) {
    return h.orch.store.createTask({
      laneId: h.laneId,
      title: 'multi-gate',
      taskType: 'IMPLEMENTATION',
    });
  }

  it('does not let a later approval override an earlier denial', () => {
    const h = makeHarness();
    const task = gatedTask(h);
    const denied = h.orch.requireFounderDecision(task.id, 'product_semantics_change', 'change meaning?');
    const approved = h.orch.requireFounderDecision(task.id, 'architecture_change', 'change shape?');

    h.orch.resolveFounderDecision(denied, 'no', 'DENIED');
    h.orch.resolveFounderDecision(approved, 'yes', 'APPROVED');

    // A refusal anywhere in the set wins, whatever order the answers arrived in.
    expect(h.orch.store.requireTask(task.id).state).toBe('BLOCKED_POLICY');
    h.orch.close();
  });

  it('does not treat a cancelled decision as approval', () => {
    const h = makeHarness();
    const task = gatedTask(h);
    const id = h.orch.requireFounderDecision(task.id, 'production_write', 'deploy?');
    h.orch.resolveFounderDecision(id, 'not now', 'CANCELLED');

    const gate = h.orch.resources.acquire({
      resourceName: 'production-write',
      task: h.orch.store.requireTask(task.id),
    });

    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe('FOUNDER_AUTHORIZATION_REQUIRED');
    h.orch.close();
  });

  it('opens a gate only for an approval', () => {
    const h = makeHarness();
    const task = gatedTask(h);
    const id = h.orch.requireFounderDecision(task.id, 'production_write', 'deploy?');
    h.orch.resolveFounderDecision(id, 'go ahead', 'APPROVED');

    const gate = h.orch.resources.acquire({
      resourceName: 'production-write',
      task: h.orch.store.requireTask(task.id),
    });

    expect(gate.ok).toBe(true);
    h.orch.close();
  });

  it('keeps the task gated while any decision is unanswered', () => {
    const h = makeHarness();
    const task = gatedTask(h);
    const first = h.orch.requireFounderDecision(task.id, 'architecture_change', 'a?');
    h.orch.requireFounderDecision(task.id, 'product_semantics_change', 'b?');

    h.orch.resolveFounderDecision(first, 'yes', 'APPROVED');

    expect(h.orch.store.requireTask(task.id).state).toBe('FOUNDER_DECISION');
    h.orch.close();
  });

  it('does not let a decision on another task open this task’s gate', () => {
    const h = makeHarness();
    const mine = gatedTask(h);
    const other = h.orch.store.createTask({ laneId: h.laneId, title: 'other', taskType: 'IMPLEMENTATION' });
    const id = h.orch.requireFounderDecision(other.id, 'production_write', 'deploy other?');
    h.orch.resolveFounderDecision(id, 'yes', 'APPROVED');

    const gate = h.orch.resources.acquire({
      resourceName: 'production-write',
      task: h.orch.store.requireTask(mine.id),
    });

    expect(gate.ok).toBe(false);
    h.orch.close();
  });

  it('does not let an approval in one category open another', () => {
    const h = makeHarness();
    const task = gatedTask(h);
    const id = h.orch.requireFounderDecision(task.id, 'merge', 'merge?');
    h.orch.resolveFounderDecision(id, 'yes', 'APPROVED');

    const gate = h.orch.resources.acquire({
      resourceName: 'production-write',
      task: h.orch.store.requireTask(task.id),
    });

    expect(gate.ok).toBe(false);
    h.orch.close();
  });

  it('fails closed when a category carries both an approval and a denial', () => {
    const h = makeHarness();
    const task = gatedTask(h);
    const a = h.orch.store.createFounderDecision({
      taskId: task.id,
      category: 'production_write',
      question: 'deploy?',
      provenance: 'test',
    });
    const b = h.orch.store.createFounderDecision({
      taskId: task.id,
      category: 'production_write',
      question: 'deploy, again?',
      provenance: 'test',
    });
    h.orch.store.setFounderDecisionState(a.id, 'RESOLVED', 'yes', 'READY', 'APPROVED');
    h.orch.store.setFounderDecisionState(b.id, 'RESOLVED', 'no', 'BLOCKED_POLICY', 'DENIED');

    const gate = h.orch.resources.acquire({
      resourceName: 'production-write',
      task: h.orch.store.requireTask(task.id),
    });

    expect(gate.ok).toBe(false);
    h.orch.close();
  });
});

describe('HIGH 5 — validated policy is immutable', () => {
  it('freezes the policy the orchestrator uses, including nested objects', () => {
    const h = makeHarness();
    expect(Object.isFrozen(h.orch.policy)).toBe(true);
    expect(Object.isFrozen(h.orch.policy.merge)).toBe(true);
    expect(Object.isFrozen(h.orch.policy.remoteWrites)).toBe(true);
    expect(Object.isFrozen(h.orch.policy.review)).toBe(true);
    expect(Object.isFrozen(h.orch.policy.review.stopWhen)).toBe(true);
    expect(Object.isFrozen(h.orch.policy.resources)).toBe(true);
    h.orch.close();
  });

  it('refuses a runtime attempt to open the merge gate', () => {
    const h = makeHarness();
    expect(() => {
      (h.orch.policy.merge as unknown as { default: string }).default = 'allowed';
    }).toThrow();
    expect(h.orch.policy.merge.default).toBe('founderRequired');
    h.orch.close();
  });

  it('refuses a runtime attempt to widen a review budget or a remote-write gate', () => {
    const h = makeHarness();
    expect(() => {
      (h.orch.policy.review as unknown as { standardMaxRounds: number }).standardMaxRounds = 99;
    }).toThrow();
    expect(() => {
      (h.orch.policy.remoteWrites as unknown as { production: string }).production = 'allowed';
    }).toThrow();
    h.orch.close();
  });

  it('freezes what parsePolicy and defaultPolicy hand out', () => {
    expect(Object.isFrozen(policySchema.parse({}))).toBe(false); // raw parse is not the entry point
    expect(Object.isFrozen(defaultPolicy())).toBe(true);
    expect(Object.isFrozen(deepFreeze({ a: { b: 1 } }).a)).toBe(true);
  });
});

describe('HIGH 6 — worker report authorization is atomic', () => {
  it('will not let an unregistered worker complete a running task', () => {
    const h = makeHarness();
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'must not be completed by a stranger',
      taskType: 'DOCS',
      requiresPr: false,
    });
    h.orch.tick();
    // Remove the lease so the task is RUNNING with nothing holding it.
    const lease = h.orch.store.getActiveWorkerLeaseForTask(task.id);
    if (lease) h.orch.store.closeWorkerLease(lease.id, 'RELEASED');
    expect(h.orch.store.requireTask(task.id).state).toBe('RUNNING');

    const result = h.orch.submitReport({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: 'wk_never_registered' }),
      status: 'COMPLETED',
    });

    expect(result.accepted).toBe(false);
    expect(h.orch.store.requireTask(task.id).state).not.toBe('DONE');
    h.orch.close();
  });

  it('will not let a registered worker without the lease complete a task', () => {
    const h = makeHarness();
    addWorkers(h, 1);
    registerReviewer(h, 'wk_bystander');
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'leased elsewhere',
      taskType: 'DOCS',
      requiresPr: false,
    });
    h.orch.tick();

    const result = h.orch.submitReport({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: 'wk_bystander' }),
      status: 'COMPLETED',
    });

    expect(result.accepted).toBe(false);
    expect(h.orch.store.requireTask(task.id).state).toBe('RUNNING');
    h.orch.close();
  });

  it('records exactly one row for a rejected report', () => {
    const h = makeHarness();
    addWorkers(h, 1);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'one audit row',
      taskType: 'DOCS',
      requiresPr: false,
    });
    h.orch.tick();

    h.orch.submitReport({
      ...baseReport({ taskId: task.id, laneId: h.laneId, workerId: 'wk_unknown' }),
      status: 'COMPLETED',
    });

    const rows = h.orch.store.db
      .prepare('SELECT accepted FROM worker_reports WHERE task_id = ?')
      .all(task.id) as Array<{ accepted: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accepted).toBe(0);
    // A rejected report must not become the task's latest accepted report.
    expect(h.orch.store.latestWorkerReport(task.id)).toBeNull();
    h.orch.close();
  });

  it('still accepts a review from a registered worker that holds no lease', () => {
    const h = makeHarness();
    registerReviewer(h, 'wk_reviewer');
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'reviewed from elsewhere',
      taskType: 'IMPLEMENTATION',
      initialState: 'WAITING_REVIEW',
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

    expect(result.accepted).toBe(true);
    expect(h.orch.store.requireTask(task.id).state).toBe('READY_TO_MERGE');
    h.orch.close();
  });
});
