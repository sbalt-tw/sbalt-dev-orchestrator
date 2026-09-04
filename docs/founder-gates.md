# Founder gates

## What a gate is

A Founder Gate is a durable row, not a convention. `FounderDecision` has a
category, a question, a state, and the task it belongs to. A gated action can
proceed only when a decision exists for **that task**, in **that category**, in
state `RESOLVED`.

## What is gated by default

| Category | Default | Configured by |
| --- | --- | --- |
| `architecture_change` | Founder required | always |
| `product_semantics_change` | Founder required | always |
| `review_budget_extension` | Founder required | always |
| `staging_write` | Founder required | `remoteWrites.staging` |
| `production_write` | Founder required | `remoteWrites.production` |
| `destructive_operation` | Founder required | `destructiveOperations.founderRequired` |
| `rollback` | Founder required | `destructiveOperations.founderRequired` |
| `merge` | Founder required | `merge.default` |

Phase 0 ships **no auto-merge**. The policy types already carry
`merge.byRiskClass`, so risk-based auto-merge is a later policy change rather
than a scheduler rewrite — but it is not implemented and the field is ignored.

## What cannot open a gate

Prose. A worker report whose `summary` says `SAFE_TO_MERGE = YES` moves nothing;
there is a test for exactly this. The engine consults `founder_decisions` and
never the text of a report.

Scope confusion also cannot open a gate:

- a resolved decision for task A does not authorise task B;
- a resolved `merge` decision does not authorise a `production_write`;
- a decision in state `REQUIRED` authorises nothing.

Each of those has a test.

## How a gate opens

```bash
dev-orch decision list --open
dev-orch decision resolve <decisionId> --resolution "approved: …"
```

Resolving a decision does two things: it marks the row `RESOLVED`, and, when the
task is parked in `FOUNDER_DECISION`, it applies `FOUNDER_DECISION_RESOLVED` to
move the task on. The default destination depends on the category — a `merge`
decision returns the task to `READY_TO_MERGE`, a `review_budget_extension`
returns it to `REVIEW_FIX` — and an explicit `--target` can override it as long
as the target is in the allowed set.

A decision can only be resolved once.

## Gated resources

Two logical resources carry `founderAuthorizationRequired: true`:
`staging-write` and `production-write`. The resource manager refuses to grant a
lease on either without the matching resolved decision, so a task that needs one
cannot even be dispatched. The scheduler records
`FOUNDER_AUTHORIZATION_REQUIRED` as the reason and leaves the task `READY`.

Note what this means in Phase 0: even with a resolved decision, nothing actually
writes to a remote environment, because no adapter can. The gate is real; the
capability behind it does not exist yet.

## Where escalation comes from

A Founder decision is created either by an operator (`dev-orch decision
require`), by a worker report carrying `founderDecisionRequired`, or by the
engine itself — a review budget exhausted with findings still open routes the
task to `FOUNDER_DECISION` automatically, because continuing to review past the
agreed budget is a human's call.
