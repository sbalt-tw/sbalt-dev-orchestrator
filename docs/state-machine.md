# State machine

Task state is finite and closed. `TaskState` and `TaskEvent` in
`src/domain/states.ts` are the entire vocabulary, and `ALLOWED_TRANSITIONS` is
the only place a transition can be introduced. There is no code path anywhere
that writes a free-form state string.

## States

| State | Meaning |
| --- | --- |
| `QUEUED` | Created; readiness not yet evaluated. |
| `WAITING_DEPENDENCY` | At least one dependency has not reached its required state. |
| `READY` | Eligible for a worker; waiting on concurrency, capability or a resource. |
| `RUNNING` | A worker holds an active lease on it. |
| `WAITING_CI` | A PR exists; CI has not reported. |
| `WAITING_REVIEW` | CI is green; awaiting a reviewer verdict. |
| `REVIEW_FIX` | A finding or a CI failure requires rework. |
| `FOUNDER_DECISION` | Parked until a human decides. |
| `BLOCKED_INFRA` | The environment failed. Recovery is explicit. |
| `BLOCKED_POLICY` | Policy forbids progress until something changes. |
| `READY_TO_MERGE` | Clean verdict at the current head; merge still gated. |
| `DONE` | Terminal. |
| `CANCELLED` | Terminal. |

`DONE` and `CANCELLED` have no outgoing transitions at all.

## Events

The event list follows the specified vocabulary, with two additions and one
rename, all deliberate:

- **`DEPENDENCIES_UNSATISFIED`** — the original list had no event for "a
  dependency is not yet met", so entering `WAITING_DEPENDENCY` would have needed
  an implicit transition. This engine has no implicit transitions.
- **`TASK_CANCELLED`** — cancellation is an operator action and is not any of
  the workflow signals.

Everything else is as specified: `TASK_CREATED`, `DEPENDENCIES_SATISFIED`,
`WORKER_ASSIGNED`, `WORKER_COMPLETED`, `WORKER_FAILED`, `PR_OPENED`,
`CI_STARTED`, `CI_PASSED`, `CI_FAILED`, `CODEX_STARTED`, `CODEX_VERDICT`,
`REVIEW_FIX_REQUIRED`, `FOUNDER_DECISION_REQUIRED`,
`FOUNDER_DECISION_RESOLVED`, `RESOURCE_UNAVAILABLE`, `RESOURCE_ACQUIRED`,
`RESOURCE_RELEASED`, `MERGE_READY`, `MERGED`, `INFRA_FAILURE`, `RECOVERED`.

## The happy path

```
QUEUED
  └─DEPENDENCIES_SATISFIED─▶ READY
                              └─WORKER_ASSIGNED─▶ RUNNING
                                                   └─PR_OPENED─▶ WAITING_CI
                                                                   └─CI_PASSED─▶ WAITING_REVIEW
                                                                                   └─CODEX_VERDICT (0B/0H)─▶ READY_TO_MERGE
                                                                                                               └─MERGED─▶ DONE
```

And the loop that actually happens most of the time:

```
WAITING_REVIEW ─CODEX_VERDICT (findings)─▶ REVIEW_FIX ─WORKER_ASSIGNED─▶ RUNNING ─▶ …
```

## Multi-target transitions

Most `(state, event)` pairs have exactly one target. Three do not, because the
destination depends on data:

- `WAITING_REVIEW --CODEX_VERDICT-->` `READY_TO_MERGE` | `REVIEW_FIX` |
  `FOUNDER_DECISION`. The engine computes this from the verdict counts and the
  remaining budget; a caller cannot choose.
- `FOUNDER_DECISION --FOUNDER_DECISION_RESOLVED-->` several states, because it
  depends what was decided. The caller must name a target and it must be in the
  allowed set.
- `BLOCKED_INFRA --RECOVERED-->` several states, same reasoning.

Ambiguity without an explicit target is rejected, and an explicit target that
contradicts the engine's own computation is rejected.

## Guards

Legality is not only about the transition table. These guards run before any
write, and each one exists because the alternative is a system that can be
talked into the wrong state:

| Event | Guard |
| --- | --- |
| `DEPENDENCIES_SATISFIED` | Verified against the dependency rows, not the caller's claim. |
| `DEPENDENCIES_UNSATISFIED` | Rejected if everything is in fact satisfied. |
| `WORKER_COMPLETED` | Refused when the task requires a PR — no shortcut to `DONE`. |
| `WORKER_ASSIGNED` | Requires an active worker lease to exist. |
| `MERGE_READY` | Requires a clean completed verdict at the exact current head. |
| `MERGED` | Requires the above **and** a resolved merge decision for this task. |
| `FOUNDER_DECISION_RESOLVED` | Requires a resolved decision belonging to this task. |

## Everything is recorded

Both outcomes are persisted. A successful transition writes an event row with
`from_state` and `to_state`; a rejection writes `REJECTED:<EVENT>` with the
reason. `dev-orch task show <id>` replays both, so "why is this stuck?" has an
answer that does not depend on anyone remembering.
