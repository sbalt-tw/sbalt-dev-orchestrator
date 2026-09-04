# Founder gates

## What a gate is

A Founder Gate is a durable row, not a convention. `FounderDecision` has a
category, a question, the task it belongs to, a lifecycle state, and — the part
that matters most — an **outcome**.

A gated action proceeds only when a decision exists for **that task**, in
**that category**, resolved with outcome `APPROVED`.

Outcome is separate from state because an approval and a refusal are both
resolutions. An earlier version read authorisation from `RESOLVED` alone, which
meant answering "no" opened the gate it was refusing.

## What is gated by default

All eight categories require a Founder decision, and in Phase 0 **none of them
can be switched off by configuration**:

| Category | Phase-0 status |
| --- | --- |
| `architecture_change` | Founder required |
| `product_semantics_change` | Founder required |
| `review_budget_extension` | Founder required |
| `staging_write` | Founder required, not configurable |
| `production_write` | Founder required, not configurable |
| `destructive_operation` | Founder required, not configurable |
| `rollback` | Founder required, not configurable |
| `merge` | Founder required, not configurable |

The policy parser accepts only the literal `founderRequired` for the
configurable-looking settings, so a policy file cannot open a gate. A gate that
a config edit can remove is not a gate; introducing risk-based automation has to
be a deliberate change to this code, reviewed on its own terms.

Phase 0 ships **no auto-merge**. `merge.byRiskClass` exists so a future phase
has somewhere to put risk-based rules, and is constrained to the same literal
today so it cannot be mistaken for a working override.

## How a set of decisions is read

Gate evaluation is deterministic and order-independent, because "whichever row
was written last" is not an authorisation model:

- a `DENIED` decision anywhere in the category wins, whenever it was written;
- `CANCELLED` authorises nothing — it is not a quiet approval;
- only `APPROVED` with no refusal opens the gate;
- a category carrying both an approval and a refusal fails closed.

The same rule decides where a task goes once every decision on it is answered:
any denial sends it to `BLOCKED_POLICY`, any cancellation to `CANCELLED`, and
only an all-approved set lets it continue. A task stays parked while **any**
decision on it is unanswered, so resolving one gate cannot release it past
another.

## Infrastructure failure does not clear a gate

A task interrupted while awaiting a decision comes back still awaiting it.
`RECOVERED` returns such a task to `FOUNDER_DECISION`, never to `QUEUED`, and
the scheduler independently refuses to dispatch any task with an outstanding
decision. An interruption is not a route around a human.

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

A gated resource must name the decision category that authorises it. Two things
follow, both enforced by the parser, the resource manager and a database CHECK
constraint:

- a resource marked as gated with no category is rejected, rather than leased
  because there was nothing to check;
- a resource inherited from an older database whose category was never recorded
  is marked `legacy_unknown`, which matches no decision category and therefore
  can never be authorised. Guessing a category would be worse than refusing:
  labelling an unknown gate `production_write` would let a production approval
  authorise something that actually guarded a rollback;
- `staging-write` and `production-write` are gated **by name**, whatever the
  configuration says, so one forgotten line cannot remove the production gate.

The resource manager refuses a lease without the matching resolved decision, so
a task that needs one cannot even be dispatched. The scheduler records
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
