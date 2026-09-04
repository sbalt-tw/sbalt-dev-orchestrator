# Worker model

## Lanes persist, workers do not

A **Lane** is a stream of work and responsibility: it has a name, a risk class,
a limit on concurrent implementation PRs, and it outlives everything that
happens inside it.

A **Worker** is compute. It is registered, it holds a lease on one task, and it
goes away. Nothing durable lives inside a worker, so a worker can be killed
mid-task without losing anything except that attempt.

This is why the schema has no "Agent 1 / Agent 2 / Agent 3". Naming workers
permanently would encode today's staffing into the data model, and the first
time the pool changed shape the model would be wrong.

## Worker count is configuration

```yaml
workers:
  maxConcurrent: 3
```

One, three, five, ten — all supported, all runtime configuration. Workers can be
added while the system is running and the next tick uses them; an idle worker
can be removed with no effect on task state.

Not every `READY` task gets a worker. The scheduler holds tasks back for reasons
it records rather than hides:

- the concurrency ceiling is reached;
- the lane already has its allowed number of active implementation PRs;
- no idle worker has the required capabilities;
- a required logical resource is at capacity, or is founder-gated and unopened.

## Capabilities, not names

A task declares what it needs:

```
requiredCapabilities: ['implementation']
```

and the scheduler finds any idle worker that has those capabilities. It never
refers to a specific worker. That indirection is what lets a future
`ClaudeCodeWorkerAdapter` be introduced by registering a provider, with no
change to the scheduler, the store or the state machine.

Conceptual providers: `claude-code`, `shell`, `github-action`, `codex`, `human`.
Phase 0 implements the abstraction plus `fake`.

## Worker leases

A dispatch creates a `WorkerLease` with a TTL. The database enforces at most one
active lease per task and per worker, with partial unique indexes — an
application-level check would be a race waiting to happen, and this one holds
even if the process dies between two statements.

A lease is renewed by heartbeat and closed when the worker reports. A lease that
expires without either is stale; see [recovery.md](recovery.md).

## The report is the whole channel

A worker communicates through a `WorkerReport` and nothing else:

```jsonc
{
  "reportVersion": 1,
  "taskId": "task_…", "laneId": "lane_…", "workerId": "wk_…",
  "status": "NEEDS_REVIEW",
  "filesChanged": ["src/thing.ts"],
  "pr":     { "number": 101, "head": "…", "base": "…", "state": "OPEN" },
  "ci":     { "status": "PASSED" },
  "review": { "reviewer": "codex", "round": 1, "baseSha": "…", "headSha": "…",
              "blocker": 0, "high": 1, "medium": 2, "low": 0,
              "status": "COMPLETED_VERDICT" },
  "founderDecisionRequired": { "category": "merge", "question": "…" },
  "architectureDecisionRequired": false,
  "recommendedNextAction": "CONTINUE_WORKER",
  "summary": "human-readable; ignored by the engine"
}
```

The schema is strict. An unknown key, an unknown status, a missing required
field, or a report from a worker that does not hold the lease are all rejected,
and the rejection is recorded in `worker_reports` with its reason. A rejected
report changes no workflow state.

`summary` exists for humans. The engine never reads it, which is the point: a
worker cannot advance the workflow by writing a convincing sentence.
