# Crash and restart

## The assumption to avoid

When an orchestrator process dies mid-dispatch, the database is left holding a
task in `RUNNING` with an `ACTIVE` worker lease and no worker behind it.

The tempting reading is that `RUNNING` plus no error means the work finished.
It does not, and this system never treats it that way. The work may have
half-finished, may have opened a PR nobody recorded, or may never have started.

## What survives a restart

Everything durable: projects, lanes, tasks and their state, dependencies, PR and
head state, review attempts, Founder decisions, resource leases, worker leases
and the full event history. There is a test that kills an orchestrator holding a
`RUNNING` task, reopens the database, and finds the task exactly where it was.

What does not survive is the worker itself, which is the point — workers are
disposable and a fresh pool can be registered at any time.

## Stale lease reconciliation

Every tick starts by reconciling. A worker lease whose `expiresAt` has passed is
treated as stale, and for each one the reconciler:

1. marks the lease `STALE`;
2. returns the worker to `IDLE`;
3. releases every resource lease the task held;
4. records a `WORKER_LEASE_STALE` history event;
5. if the task is `RUNNING`, applies `INFRA_FAILURE`, moving it to
   `BLOCKED_INFRA`.

Steps 2 and 3 matter as much as step 5. A dead process holding the only `codex`
slot would otherwise block every other task that needs it, forever.

## Recovery is a decision

A task in `BLOCKED_INFRA` stays there. Ticking again does not re-dispatch it;
there is a test that ticks twice and asserts nothing moves. Putting it back in
play requires an explicit `RECOVERED` event naming a target state.

The alternative — automatically re-running anything that looked interrupted — is
how you get two workers on the same branch, two PRs for one task, or a
half-applied migration applied a second time. An operator or a policy decides
when re-running is safe.

## Clocks

Lease expiry is judged on the store's clock, and `tick()` defaults to that same
clock rather than wall time.

This was a real defect caught by the test suite: the store wrote expiry
timestamps from an injected clock while the scheduler compared them against
`new Date()`. On a test clock, healthy leases were reconciled as stale
immediately. Anything comparing timestamps goes through `Store.nowDate()`.

## Double-dispatch protection

Two partial unique indexes enforce at most one `ACTIVE` worker lease per task
and per worker:

```sql
CREATE UNIQUE INDEX idx_worker_leases_one_active_per_task
  ON worker_leases(task_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX idx_worker_leases_one_active_per_worker
  ON worker_leases(worker_id) WHERE status = 'ACTIVE';
```

This is enforced by the database rather than by application discipline, so it
holds even if a process dies between two statements.

## Reading the history

```bash
dev-orch task show <taskId>
```

The `events` table answers the questions that otherwise require someone's
memory: why is this task blocked, who required a Founder decision, which review
round failed, and which worker held a resource when everything stopped.
