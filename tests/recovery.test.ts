import { afterAll, describe, expect, it } from 'vitest';
import { Orchestrator } from '../src/orchestrator.js';
import { FakeClock, addWorkers, cleanupTempDirs, makeHarness, testPolicy, tmpDbPath } from './helpers.js';
import { CAPABILITIES } from '../src/workers/provider.js';

afterAll(cleanupTempDirs);

describe('crash and restart recovery', () => {
  it('survives a process death mid-task without forgetting the work', () => {
    const dbPath = tmpDbPath();
    const clock = new FakeClock();
    const policy = testPolicy({ workers: { maxConcurrent: 2, leaseTtlMs: 60_000 } });

    // --- first process ---
    const h = makeHarness({ policy, dbPath, clock });
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'interrupted work',
      taskType: 'DOCS',
      requiresPr: false,
      requiredResources: [],
    });
    addWorkers(h, 1);
    h.orch.tick();
    expect(h.orch.store.requireTask(task.id).state).toBe('RUNNING');
    // Simulate the process dying: no report, no clean shutdown of the lease.
    h.orch.close();

    // --- restart ---
    const clock2 = new FakeClock();
    const restarted = new Orchestrator({ dbPath, policy, clock: clock2 });
    restarted.init();

    // The task is still there and still RUNNING; nothing was forgotten and
    // nothing was assumed finished.
    expect(restarted.store.requireTask(task.id).state).toBe('RUNNING');
    expect(restarted.store.listActiveWorkerLeases()).toHaveLength(1);

    restarted.close();
  });

  it('reconciles a stale lease into BLOCKED_INFRA rather than assuming success', () => {
    const dbPath = tmpDbPath();
    const clock = new FakeClock();
    const policy = testPolicy({
      workers: { maxConcurrent: 2, leaseTtlMs: 60_000 },
      resources: [{ name: 'codex', capacity: 1 }],
    });

    const h = makeHarness({ policy, dbPath, clock });
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'held a scarce slot when it died',
      taskType: 'DOCS',
      requiresPr: false,
      requiredResources: ['codex'],
    });
    addWorkers(h, 1);
    h.orch.tick();
    expect(h.orch.store.requireTask(task.id).state).toBe('RUNNING');
    expect(h.orch.resources.available('codex')).toBe(0);
    h.orch.close();

    // Restart after the lease TTL has passed.
    const clock2 = new FakeClock();
    clock2.advance(120_000);
    const restarted = new Orchestrator({ dbPath, policy, clock: clock2 });
    restarted.init();

    const result = restarted.tick(clock2.now());

    expect(result.reconcile.staleLeases).toBe(1);
    expect(result.reconcile.tasksBlocked).toContain(task.id);
    expect(restarted.store.requireTask(task.id).state).toBe('BLOCKED_INFRA');
    // The scarce slot and the worker both came back.
    expect(restarted.resources.available('codex')).toBe(1);
    expect(restarted.store.listWorkers('IDLE')).toHaveLength(1);
    restarted.close();
  });

  it('does not silently re-dispatch a recovered task into a second execution', () => {
    const dbPath = tmpDbPath();
    const policy = testPolicy({ workers: { maxConcurrent: 2, leaseTtlMs: 60_000 } });

    const h = makeHarness({ policy, dbPath, clock: new FakeClock() });
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'must not run twice',
      taskType: 'DOCS',
      requiresPr: false,
    });
    addWorkers(h, 1);
    h.orch.tick();
    h.orch.close();

    const clock2 = new FakeClock();
    clock2.advance(120_000);
    const restarted = new Orchestrator({ dbPath, policy, clock: clock2 });
    restarted.init();

    const first = restarted.tick(clock2.now());
    expect(first.dispatched).toHaveLength(0);
    expect(restarted.store.requireTask(task.id).state).toBe('BLOCKED_INFRA');

    // Still blocked on the next tick: recovery is a decision, not a side effect.
    const second = restarted.tick(clock2.now());
    expect(second.dispatched).toHaveLength(0);
    expect(restarted.store.requireTask(task.id).state).toBe('BLOCKED_INFRA');

    // An explicit RECOVERED event is what puts it back in play.
    const recovered = restarted.engine.apply({
      taskId: task.id,
      event: 'RECOVERED',
      actor: 'operator',
      target: 'QUEUED',
    });
    expect(recovered.ok).toBe(true);
    expect(restarted.tick(clock2.now()).dispatched).toHaveLength(1);
    restarted.close();
  });

  it('keeps at most one active lease per task even under repeated ticks', () => {
    const h = makeHarness({ policy: testPolicy({ workers: { maxConcurrent: 3, leaseTtlMs: 60_000 } }) });
    addWorkers(h, 3);
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'single lease',
      taskType: 'DOCS',
      requiresPr: false,
    });

    h.orch.tick();
    h.orch.tick();
    h.orch.tick();

    const leases = h.orch.store.db
      .prepare("SELECT COUNT(*) AS n FROM worker_leases WHERE task_id = ? AND status = 'ACTIVE'")
      .get(task.id) as { n: number };
    expect(leases.n).toBe(1);
    h.orch.close();
  });

  it('persists lanes, tasks and decisions across a restart', () => {
    const dbPath = tmpDbPath();
    const policy = testPolicy();

    const h = makeHarness({ policy, dbPath });
    const task = h.orch.store.createTask({
      laneId: h.laneId,
      title: 'durable',
      taskType: 'IMPLEMENTATION',
    });
    const decisionId = h.orch.requireFounderDecision(task.id, 'architecture_change', 'change?');
    const laneId = h.laneId;
    h.orch.close();

    const restarted = new Orchestrator({ dbPath, policy });
    restarted.init();

    expect(restarted.store.getLane(laneId)).not.toBeNull();
    expect(restarted.store.requireTask(task.id).title).toBe('durable');
    expect(restarted.store.getFounderDecision(decisionId)?.state).toBe('REQUIRED');
    // Workers, by contrast, are disposable: a fresh pool can be registered.
    restarted.store.registerWorker({ provider: 'fake', capabilities: [CAPABILITIES.implementation] });
    expect(restarted.store.listWorkers().length).toBeGreaterThan(0);
    restarted.close();
  });
});
