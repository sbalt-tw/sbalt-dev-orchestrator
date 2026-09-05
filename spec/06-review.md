# 06 · Review, severity and disposition

## Two vocabularies that never borrow from each other

**Finding severity** is exactly `BLOCKER` · `HIGH` · `MEDIUM` · `LOW`. A provider
reporting `CRITICAL` is recorded as `BLOCKER` with identical treatment everywhere; there
is no separate critical severity.

**Slice risk** is a different axis with its own words — `HIGHEST-RISK`, `HIGH-RISK`,
`MODERATE`, `LOW-RISK` — and PR-F is the highest-risk slice. Risk labels never borrow
severity words and severity never borrows risk words.

## Rules

| Rule | Statement |
|---|---|
| R1 | Completed-verdict budget: 2 rounds for PR-0 and for each slice, 3 for PR-F, 1 for PR-I. |
| R2 | No automatic extra rounds; an extension is a Founder decision requested with its reason. |
| R3 | A new head is created by **any commit touching a tracked file**. GitHub discussion and review comments do not create a head and do not invalidate a verdict. |
| R4 | `0B/0H` means the **aggregate** over the tuple carries no unresolved blocking finding — not that the latest verdict happened to count zero. Merge candidacy additionally requires every medium and low to be dispositioned. |
| R5 | At `0B/0H` the automatic fix loop stops. There is no reassurance round. |
| R6 | Codex reviews the complete diff and may raise findings outside the ledger. A finding naming a rule the specification lacks is a **specification gap**: the slice stops and returns to the Founder. It is never patched inside a round. |
| R7 | Budget exhausted with a blocker or high outstanding is a hard stop returning to the Founder. |
| R8 | Blocking findings are durable against their tuple; a later clean verdict on the same tuple resolves nothing. Only a new tuple or a named `waive_finding` resolves one. |
| R9 | Infrastructure aborts consume no round and are classified only by a trusted terminal result. One exact operation on one exact tuple gets **two attempts** — the first plus at most one retry, never concurrent, each with its own attempt identity — under the named key `infrastructure.max_attempts_per_operation`. Before a third attempt the task becomes `BLOCKED` with an `INFRASTRUCTURE` obligation and returns to the Founder. See [16-non-waivable.md](16-non-waivable.md). |
| R10 | Reviewer capacity is 1 per authority domain, claimed by the algorithm in [05-leases.md](05-leases.md) and measured in in-flight invocations. |
| R11 | The conformance suite is indexed by invariant ID, grows with each slice and never shrinks. |

## Medium and low disposition

Every medium and low requires a **named Founder disposition before merge candidacy,
with no default**:

| Disposition | Meaning |
|---|---|
| `FIX` | Produces a new head and therefore full re-validation, CI, and a review of the exact new head within budget. |
| `ACCEPT` | Records the behaviour as designed. |
| `DEFER` | Records debt against an invariant, with an owner and a target slice or phase. |

An undispositioned medium blocks merge exactly as a high would. **Silence is not
acceptance.**

## Review independence

The reviewer is a principal distinct from the implementing principal and reviews the
complete `base → head` diff, never only the last commit. Reviewer independence is not
reduced to make convergence easier; convergence comes from small implementation scope.
