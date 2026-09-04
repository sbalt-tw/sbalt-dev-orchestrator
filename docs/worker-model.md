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

**A known limitation, stated rather than papered over.** `WorkerProvider.dispatch`
takes one call and returns one finished report. That shape suits a fake worker
and proves the orchestration semantics, but a real long-running worker needs
more: a start acknowledgement, a lease token to heartbeat with, cancellation, and
an asynchronous report callback. Designing that lifecycle is the first task of
Phase 1A, before any real adapter is written. It changes this interface; it does
not change the store, the state machine or the scheduler.

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

The schema is strict, and authorisation happens in the same transaction as the
application, so nothing it checks can change in between. A report is refused
when it has an unknown key, an unknown status, a missing required field, or when
its author is not entitled to say what it says:

- the worker must be **registered**;
- a report carrying an outcome — a PR, a completion, a failure, a block, a
  decision request — must come from the worker **currently holding the task's
  lease**;
- review and CI results describe something that happened elsewhere, so they need
  a registered worker but not the lease;
- a lease that has passed its expiry is not authority. A report arriving after
  the TTL but before the next tick is refused, so a worker the system has
  already given up on cannot change state — and so reconciliation still gets to
  record that the lease expired.

Every component of a report has to land. If any transition it implies is
refused, the whole report is rolled back and recorded as rejected; committing an
accepted report whose transition failed let a late blocking verdict be filed
while the task stayed merge-ready.

That last asymmetry is a Phase-0 simplification. A real deployment wants a
separate authenticated contract for review and CI results rather than accepting
them from any registered worker; it is recorded as follow-up debt.

A rejected report changes no workflow state and leaves exactly one audit row in
`worker_reports` with its reason.

`summary` exists for humans. The engine never reads it, which is the point: a
worker cannot advance the workflow by writing a convincing sentence.
