# 15 · The task state model

Authority: **D15**. Canonical data: [`manifests/task-state.json`](manifests/task-state.json).

Round 1 of the PR-0 review found that the specification named INV-S1, INV-S2 and INV-S3 but
never said what the states were. PR-A could have defined one state and PR-B an empty
transition table, and both invariants would have passed vacuously. This chapter is what
those invariants are about.

## Nine states, three terminal

| State | Terminal | Meaning |
|---|---|---|
| `PENDING` | no | Created; its dependencies are not yet satisfied. |
| `READY` | no | Schedulable. |
| `DISPATCHING` | no | A `worker_dispatch` redemption has committed its intent; the worker is not yet confirmed. |
| `RUNNING` | no | A worker is confirmed to be working on it. |
| `WAITING` | no | At least one waiting obligation is open. |
| `BLOCKED` | no | At least one blocking obligation is open. |
| `SUCCEEDED` | **yes** | Definitively complete. |
| `FAILED` | **yes** | Definitively failed. |
| `CANCELLED` | **yes** | Cancelled by an authenticated principal. |

The initial state is `PENDING`. A terminal state has **no outgoing transition**. Repeating
terminal work means creating a new task or a new attempt with its own identity; a terminal
task is never revived.

## Two layers

Task state records **lifecycle**. Every waiting or blocking reason is a **separately
persisted obligation**, and the state label never overwrites it.

| Layer | Obligations |
|---|---|
| `WAITING` | `EVIDENCE` · `FOUNDER_DECISION` · `EFFECT_RECONCILIATION` |
| `BLOCKED` | `INFRASTRUCTURE` · `POLICY` · `AUTHORITY_LOST` · `DEPENDENCY_FAILED` |

* A task may hold **several obligations at once**.
* Resolving one **never** clears another.
* The state label is derived: `BLOCKED` while any blocker is open; otherwise `WAITING`
  while any waiting obligation is open; otherwise the lifecycle state stands.
* Opening and resolving obligations are append-only events. A resolved obligation is
  never deleted.

This is what INV-S4 means in practice: an interruption cannot clear an obligation, because
the obligation is not stored in the thing the interruption disturbs.

## Thirteen events

`TASK_CREATED` · `DEPENDENCIES_SATISFIED` · `DISPATCH_INTENT_RECORDED` ·
`DISPATCH_CONFIRMED` · `DISPATCH_AMBIGUOUS` · `WORKER_REPORT_ACCEPTED` ·
`OBLIGATION_OPENED` · `OBLIGATION_RESOLVED` · `BLOCKER_OPENED` · `BLOCKER_RESOLVED` ·
`DEFINITIVE_SUCCESS` · `DEFINITIVE_FAILURE` · `CANCELLATION_AUTHENTICATED`

They cover, in order, task creation, dependency satisfaction, dispatch intent, dispatch
success, dispatch ambiguity, worker report, obligation open and resolve, blocker open and
resolve, definitive success, definitive failure and authenticated cancellation.

## The table is total

Nine states × thirteen events = **117 pairs**, and every one carries an explicit `ALLOWED`
or `REFUSED` decision in the manifest. **There is no wildcard, catch-all or default
transition.** An allowed cell states its target rule; a refused cell states its reason.
Twenty-nine cells are allowed and eighty-eight are refused.

Refusal is not silence: **every refused transition is written to the append-only history**
with its event, its source state and its reason (INV-S6).

## The caller never chooses the target

A caller submits an **event** and may **assert** what it believes to be true. It never
submits a target state. The target is resolved from persisted facts, and an assertion that
contradicts them is refused rather than obeyed (INV-S3).

Where the target depends on what else is open, the manifest says so rather than naming a
state: for `OBLIGATION_RESOLVED` and `BLOCKER_RESOLVED` the destination is *computed* —
`BLOCKED` while any blocker remains, else `WAITING` while any obligation remains, else
`READY`.

## Dispatch ambiguity is not failure

`DISPATCH_AMBIGUOUS` moves a task to `WAITING` with an `EFFECT_RECONCILIATION` obligation.
It is never recorded as a failed dispatch, because an ambiguous external outcome is
unknown, not negative ([04-journal.md](04-journal.md)).

## Six preconditions for success

`DEFINITIVE_SUCCESS` is permitted only from `RUNNING`, and only when **all six** hold:

1. No obligation of any kind is open.
2. No blocking review finding on the current tuple is unresolved.
3. CI is recorded as passed for the exact current tuple, from the recomputed current
   evidence snapshot.
4. The acting principal holds a valid, unexpired lease.
5. No effect-journal entry for the task is `UNKNOWN_PENDING_RECONCILIATION`.
6. No effect-journal entry for the task is `ABANDONED_BY_DECISION`.

They are conjunctive. Violating any one of them refuses the transition.

## Abandonment releases nothing

`ABANDONED_BY_DECISION`:

* never releases a task from any obligation;
* never satisfies a dependency for another task;
* never satisfies the Phase 0 completion gate condition G0-8.

Renaming an unknown outcome does not determine it.
