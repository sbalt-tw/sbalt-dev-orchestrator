#!/usr/bin/env node
/**
 * Operator CLI.
 *
 * Phase 0 has no dashboard. This is the whole operator surface: inspect state,
 * create work, run a scheduler tick, and resolve Founder decisions. Every
 * command supports --json so it can be scripted.
 */

import { Command } from 'commander';
import { Orchestrator } from '../orchestrator.js';
import { FakeWorkerProvider } from '../workers/fake.js';
import { CAPABILITIES } from '../workers/provider.js';
import { FOUNDER_DECISION_CATEGORIES, RISK_CLASSES, TASK_TYPES } from '../domain/entities.js';
import { appliedMigrations } from '../state/db.js';
import { runDemo } from '../demo/scenario.js';

interface GlobalOpts {
  db?: string;
  policy?: string;
  json?: boolean;
}

function openOrchestrator(opts: GlobalOpts): Orchestrator {
  const orch = new Orchestrator({
    ...(opts.db ? { dbPath: opts.db } : {}),
    ...(opts.policy ? { policyPath: opts.policy } : {}),
  });
  orch.init();
  return orch;
}

function output(json: boolean | undefined, data: unknown, human: () => void): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    human();
  }
}

const program = new Command();
program
  .name('dev-orch')
  .description('SBALT Development Orchestrator — durable multi-agent workflow state')
  .option('--db <path>', 'SQLite state file (default .dev-orch/state.sqlite)')
  .option('--policy <path>', 'policy file (default config/policy.yaml)')
  .option('--json', 'machine-readable output');

const globals = (): GlobalOpts => program.opts<GlobalOpts>();

program
  .command('init')
  .description('create the state database and load policy-declared resources')
  .action(() => {
    const orch = openOrchestrator(globals());
    const migrations = appliedMigrations(orch.store.db);
    const resources = orch.resources.definitions();
    output(globals().json, { migrations, resources }, () => {
      console.log(`initialised. migrations applied: ${migrations.map((m) => m.version).join(', ')}`);
      console.log('resources:');
      for (const r of resources) {
        console.log(
          `  ${r.name}  capacity=${r.capacity}${r.founderAuthorizationRequired ? '  [founder-gated]' : ''}`,
        );
      }
    });
    orch.close();
  });

program
  .command('status')
  .description('summary of lanes, tasks, workers, resources and open decisions')
  .action(() => {
    const orch = openOrchestrator(globals());
    const tasks = orch.store.listTasks();
    const byState = tasks.reduce<Record<string, number>>((acc, t) => {
      acc[t.state] = (acc[t.state] ?? 0) + 1;
      return acc;
    }, {});
    const data = {
      lanes: orch.store.listLanes().length,
      tasks: tasks.length,
      tasksByState: byState,
      workers: orch.store.listWorkers().map((w) => ({ id: w.id, provider: w.provider, status: w.status })),
      resources: orch.resources.definitions().map((r) => ({
        name: r.name,
        capacity: r.capacity,
        available: orch.resources.available(r.name),
        founderGated: r.founderAuthorizationRequired,
      })),
      openDecisions: orch.store.listFounderDecisions({ state: 'REQUIRED' }).length,
      selfHosting: orch.policy.selfHosting.enabled,
    };
    output(globals().json, data, () => {
      console.log(`lanes=${data.lanes} tasks=${data.tasks} openDecisions=${data.openDecisions}`);
      for (const [state, n] of Object.entries(byState)) console.log(`  ${state}: ${n}`);
      console.log('workers:');
      for (const w of data.workers) console.log(`  ${w.id} ${w.provider} ${w.status}`);
      console.log('resources:');
      for (const r of data.resources) {
        console.log(`  ${r.name} ${r.available}/${r.capacity}${r.founderGated ? ' [founder-gated]' : ''}`);
      }
    });
    orch.close();
  });

// ------------------------------------------------------------------- lanes

const lane = program.command('lane').description('lane operations');

lane
  .command('list')
  .description('list lanes')
  .action(() => {
    const orch = openOrchestrator(globals());
    const lanes = orch.store.listLanes();
    output(globals().json, lanes, () => {
      for (const l of lanes) {
        console.log(`${l.id}  ${l.name}  risk=${l.riskClass}  maxPRs=${l.maxActiveImplementationPrs}  ${l.status}`);
      }
    });
    orch.close();
  });

lane
  .command('create')
  .description('create a lane')
  .requiredOption('--project <name>', 'project name (created if absent)')
  .requiredOption('--name <name>', 'lane name')
  .option('--risk <class>', `risk class (${RISK_CLASSES.join('|')})`, 'STANDARD')
  .option('--max-prs <n>', 'max active implementation PRs', '1')
  .action((opts: { project: string; name: string; risk: string; maxPrs: string }) => {
    const orch = openOrchestrator(globals());
    const project =
      orch.store.getProjectByName(opts.project) ?? orch.store.createProject(opts.project, orch.adapter.id);
    const created = orch.store.createLane({
      projectId: project.id,
      name: opts.name,
      riskClass: opts.risk as (typeof RISK_CLASSES)[number],
      maxActiveImplementationPrs: Number(opts.maxPrs),
    });
    output(globals().json, created, () => console.log(`created lane ${created.id}`));
    orch.close();
  });

// ------------------------------------------------------------------- tasks

const task = program.command('task').description('task operations');

task
  .command('list')
  .description('list tasks')
  .option('--lane <id>', 'filter by lane')
  .action((opts: { lane?: string }) => {
    const orch = openOrchestrator(globals());
    const tasks = orch.store.listTasks(opts.lane ? { laneId: opts.lane } : {});
    output(globals().json, tasks, () => {
      for (const t of tasks) {
        console.log(`${t.id}  [${t.state}]  p=${t.priority}  ${t.taskType}  ${t.title}`);
      }
    });
    orch.close();
  });

task
  .command('show <id>')
  .description('show one task with dependencies, reviews, decisions and history')
  .action((id: string) => {
    const orch = openOrchestrator(globals());
    const t = orch.store.getTask(id);
    if (!t) {
      console.error(`unknown task ${id}`);
      orch.close();
      process.exitCode = 1;
      return;
    }
    const data = {
      task: t,
      dependencies: orch.snapshotFor(id).dependencies,
      reviews: orch.store.listReviewAttempts(id),
      decisions: orch.store.listFounderDecisions({ taskId: id }),
      history: orch.store.listEvents(id, 50),
    };
    output(globals().json, data, () => {
      console.log(`${t.id}  [${t.state}]  ${t.title}`);
      console.log(`  lane=${t.laneId} type=${t.taskType} risk=${t.riskClass} priority=${t.priority}`);
      console.log(`  pr=${t.prNumber ?? '-'} head=${t.prHeadSha ?? '-'} ci=${t.ciStatus}`);
      if (data.dependencies.length > 0) {
        console.log('  dependencies:');
        for (const d of data.dependencies) {
          console.log(`    ${d.dependsOnTaskId} needs ${d.requiredState}, is ${d.actualState} -> ${d.satisfied ? 'ok' : 'waiting'}`);
        }
      }
      if (data.reviews.length > 0) {
        console.log('  reviews:');
        for (const r of data.reviews) {
          console.log(`    round ${r.round} ${r.status} head=${r.headSha} B=${r.blocker} H=${r.high} M=${r.medium} L=${r.low}`);
        }
      }
      if (data.decisions.length > 0) {
        console.log('  founder decisions:');
        for (const d of data.decisions) console.log(`    ${d.id} ${d.category} ${d.state}`);
      }
      console.log('  recent history:');
      for (const e of data.history.slice(0, 12)) {
        console.log(`    ${e.createdAt} ${e.eventType} ${e.fromState ?? '-'} -> ${e.toState ?? '-'} (${e.actor})`);
      }
    });
    orch.close();
  });

task
  .command('create')
  .description('create a task')
  .requiredOption('--lane <id>', 'lane id')
  .requiredOption('--title <title>', 'task title')
  .option('--type <type>', `task type (${TASK_TYPES.join('|')})`, 'IMPLEMENTATION')
  .option('--risk <class>', `risk class (${RISK_CLASSES.join('|')})`, 'STANDARD')
  .option('--priority <n>', 'priority (higher runs first)', '0')
  .option('--no-pr', 'task does not require a PR')
  .option('--resources <list>', 'comma-separated required resources', '')
  .option('--capabilities <list>', 'comma-separated required worker capabilities', '')
  .action(
    (opts: {
      lane: string;
      title: string;
      type: string;
      risk: string;
      priority: string;
      pr: boolean;
      resources: string;
      capabilities: string;
    }) => {
      const orch = openOrchestrator(globals());
      const split = (s: string): string[] => s.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
      const created = orch.store.createTask({
        laneId: opts.lane,
        title: opts.title,
        taskType: opts.type as (typeof TASK_TYPES)[number],
        riskClass: opts.risk as (typeof RISK_CLASSES)[number],
        priority: Number(opts.priority),
        requiresPr: opts.pr,
        requiredResources: split(opts.resources),
        requiredCapabilities: split(opts.capabilities),
      });
      orch.store.appendEvent({
        taskId: created.id,
        eventType: 'TASK_CREATED',
        actor: 'operator',
        toState: created.state,
        payload: { title: created.title },
      });
      output(globals().json, created, () => console.log(`created task ${created.id}`));
      orch.close();
    },
  );

// ----------------------------------------------------------------- workers

const worker = program.command('worker').description('worker pool operations');

worker
  .command('list')
  .description('list workers')
  .action(() => {
    const orch = openOrchestrator(globals());
    const workers = orch.store.listWorkers();
    output(globals().json, workers, () => {
      for (const w of workers) {
        console.log(`${w.id}  ${w.provider}  ${w.status}  caps=[${w.capabilities.join(', ')}]`);
      }
    });
    orch.close();
  });

worker
  .command('add')
  .description('register a worker (workers are disposable; add and remove freely)')
  .option('--provider <name>', 'provider name', 'fake')
  .option('--capabilities <list>', 'comma-separated capabilities', `${CAPABILITIES.implementation},${CAPABILITIES.docs}`)
  .action((opts: { provider: string; capabilities: string }) => {
    const orch = openOrchestrator(globals());
    const created = orch.store.registerWorker({
      provider: opts.provider,
      capabilities: opts.capabilities.split(',').map((c) => c.trim()).filter((c) => c.length > 0),
    });
    output(globals().json, created, () => console.log(`registered worker ${created.id}`));
    orch.close();
  });

worker
  .command('remove <id>')
  .description('remove an idle worker')
  .action((id: string) => {
    const orch = openOrchestrator(globals());
    const w = orch.store.getWorker(id);
    if (!w) {
      console.error(`unknown worker ${id}`);
      orch.close();
      process.exitCode = 1;
      return;
    }
    if (w.status === 'BUSY') {
      console.error(`worker ${id} is BUSY; release its lease before removing it`);
      orch.close();
      process.exitCode = 1;
      return;
    }
    orch.store.removeWorker(id);
    output(globals().json, { removed: id }, () => console.log(`removed worker ${id}`));
    orch.close();
  });

// --------------------------------------------------------------- scheduler

const scheduler = program.command('scheduler').description('scheduler operations');

scheduler
  .command('tick')
  .description('run one deterministic scheduler pass')
  .action(() => {
    const orch = openOrchestrator(globals());
    const result = orch.tick();
    output(globals().json, result, () => {
      console.log(
        `reconciled ${result.reconcile.staleLeases} stale lease(s); readied ${result.readied.length}; dispatched ${result.dispatched.length}`,
      );
      for (const d of result.dispatched) console.log(`  dispatch ${d.taskId} -> worker ${d.workerId}`);
      for (const s of result.skipped) console.log(`  skip ${s.taskId}: ${s.reason}`);
    });
    orch.close();
  });

// --------------------------------------------------------------- decisions

const decision = program.command('decision').description('Founder Gate operations');

decision
  .command('list')
  .description('list founder decisions')
  .option('--open', 'only decisions still REQUIRED')
  .action((opts: { open?: boolean }) => {
    const orch = openOrchestrator(globals());
    const decisions = orch.store.listFounderDecisions(opts.open ? { state: 'REQUIRED' } : {});
    output(globals().json, decisions, () => {
      for (const d of decisions) {
        console.log(`${d.id}  ${d.state}  ${d.category}  task=${d.taskId ?? '-'}\n    ${d.question}`);
      }
    });
    orch.close();
  });

decision
  .command('require')
  .description('record that a task needs a Founder decision')
  .requiredOption('--task <id>', 'task id')
  .requiredOption('--category <category>', FOUNDER_DECISION_CATEGORIES.join('|'))
  .requiredOption('--question <text>', 'what the Founder must decide')
  .action((opts: { task: string; category: string; question: string }) => {
    const orch = openOrchestrator(globals());
    const id = orch.requireFounderDecision(
      opts.task,
      opts.category as (typeof FOUNDER_DECISION_CATEGORIES)[number],
      opts.question,
    );
    output(globals().json, { decisionId: id }, () => console.log(`decision ${id} recorded as REQUIRED`));
    orch.close();
  });

decision
  .command('resolve <id>')
  .description('answer a Founder decision (an APPROVED outcome is the only thing that opens a gate)')
  .requiredOption('--resolution <text>', 'what was decided')
  .requiredOption('--outcome <outcome>', `APPROVED | DENIED | CANCELLED`)
  .option('--target <state>', 'explicit next task state')
  .action((id: string, opts: { resolution: string; outcome: string; target?: string }) => {
    const orch = openOrchestrator(globals());
    const outcome = opts.outcome.toUpperCase();
    if (outcome !== 'APPROVED' && outcome !== 'DENIED' && outcome !== 'CANCELLED') {
      console.error(`--outcome must be APPROVED, DENIED or CANCELLED (got ${opts.outcome})`);
      orch.close();
      process.exitCode = 1;
      return;
    }
    const result = orch.resolveFounderDecision(
      id,
      opts.resolution,
      outcome,
      opts.target as Parameters<Orchestrator['resolveFounderDecision']>[3],
    );
    output(globals().json, result, () => {
      if (!result.ok) console.error(`failed: ${result.reason}`);
      else console.log(`resolved ${id}${result.transition?.ok ? ` -> ${result.transition.to}` : ''}`);
    });
    if (!result.ok) process.exitCode = 1;
    orch.close();
  });

// -------------------------------------------------------------------- demo

program
  .command('demo')
  .description('run the synthetic Phase-0 demonstration scenario (no real project touched)')
  .action(async () => {
    const result = await runDemo();
    output(globals().json, result, () => {
      for (const line of result.timeline) console.log(line);
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

// Providers are registered by callers; the CLI exposes the fake one so
// `dev-orch demo` can run with no external dependency.
export { FakeWorkerProvider };
