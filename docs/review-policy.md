# Review policy

## Reviews are numbers, not paragraphs

A `ReviewAttempt` records the reviewer, the round, the base and head SHAs, four
finding counts, and whether the attempt actually produced a verdict. The
orchestrator decides from those fields alone.

This matters more than it sounds. A reviewer that writes a reassuring summary
while reporting `high: 1` still sends the task back for a fix, because the
routing reads the number.

## Stopping early

```yaml
review:
  stopWhen:
    blocker: 0
    high: 0
```

A completed verdict at or below those counts is clean and moves the task to
`READY_TO_MERGE`. Anything above sends it to `REVIEW_FIX`. There is no
"reassurance round": once a review is clean, review is finished.

## Budgets

```yaml
review:
  standardMaxRounds: 3
  highRiskMaxRounds: 5
```

A task may override with its own `reviewMaxRounds`. When the budget is exhausted
and findings are still outstanding, the task goes to `FOUNDER_DECISION` and the
engine creates the `review_budget_extension` decision in the same transaction —
continuing past the agreed budget is a human decision, not something the loop
grants itself, and the task is never parked with nothing to resolve.

## An infrastructure abort costs no round

A review attempt has three statuses: `RUNNING`, `COMPLETED_VERDICT` and
`INFRA_ABORTED`. Only `COMPLETED_VERDICT` consumes a round, and that is not
configurable.

The reasoning: "budget exhausted" should mean reviewers actually looked and
still found something. If a machine runs out of disk three times, the task has
had zero real reviews, and treating that as three used rounds would escalate a
question no human can answer. The attempt is still recorded, so the flakiness is
visible.

An earlier draft made this a policy toggle. It was removed: a published
guarantee that a config file can quietly invert is not a guarantee.

## Merge is anchored to an exact head

`cleanAtCurrentHead()` looks at the **latest** completed verdict at the task's
current `prHeadSha`. Asking whether *some* clean verdict existed meant a later
reviewer finding a blocker at the same commit could not take back the earlier
all-clear. A blocking verdict arriving after a task is already merge-ready sends
it back to `REVIEW_FIX`.

A clean verdict on an earlier commit says nothing about the commit that would
actually be merged. So when a branch moves — a rebase, a fix, a force-push —
the previous clean verdict stops counting, `MERGE_READY` is refused, and
`MERGED` is refused. Both are tested.

## The order of gates

For a merge to happen, all of these must hold:

1. the task is in `READY_TO_MERGE`;
2. a completed verdict at the exact current head reports 0 blocker and 0 high;
3. a `merge` Founder decision for this task is `RESOLVED`.

Failing any one produces a rejection with a reason, recorded in history.

## What is not implemented

Nothing here starts, schedules or talks to a reviewer. Reviews enter the system
as `WorkerReport.review`. Wiring a real reviewer means mapping the logical
`codex` resource to whatever guards it in the target project and having an
adapter produce that field.
