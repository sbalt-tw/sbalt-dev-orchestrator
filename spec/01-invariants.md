# 01 · The 47 invariants

<!-- GENERATED FROM spec/manifests/invariants.json BY tools/spec/render.ts — DO NOT EDIT BY HAND. -->

**47 invariants in 8 families.** Each carries four owners: who states it (normative), who enforces it (enforcement), who stores what it constrains (persistence), and who tests it (test). A persistence owner of `n/a` carries an explicit note saying why nothing is stored, and only the two invariants the anchor permits may claim it.

Statements marked **sharpened** were tightened by the Binding Founder Errata or by a later Founder decision; the errata and decisions that reached each one are listed with it. See [12-errata.md](12-errata.md) and [09-decisions.md](09-decisions.md).

## Family A — authorization (9)

### INV-A1

Absence is never consent. Unknown, unreadable, missing, expired or stale authority always fails closed. A deferred decision is an absence: the absence of a Phase-1A decision is not permission to begin Phase-1A work.

*Sharpened by FE-5, FE-8.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-A, PR-B, PR-C, PR-D, PR-E, PR-F, PR-G, PR-H, PR-I |
| persistence | n/a — A1 is a reading rule applied to persisted facts owned by other invariants; it persists nothing of its own. |
| test | PR-A, PR-B, PR-C, PR-D, PR-E, PR-F, PR-G, PR-H, PR-I |

Introduced in PR-0; inherited by PR-A, PR-B, PR-C, PR-D, PR-E, PR-F, PR-G, PR-H, PR-I.

- `conf/A1/PR-F/missing-authority-fails-closed` (positive, PR-F) — A gated action with no readable authorization is refused.
- `conf/A1/PR-F/silence-is-not-approval` (negative, PR-F) — An unanswered, expired or unreadable decision must not authorise; the test fails if any such state permits the action.

### INV-A2

Authorization requires an explicit recorded outcome. APPROVED, DENIED and CANCELLED are distinct and lifecycle state alone never implies one. Only APPROVED may be redeemed; DENIED and CANCELLED never consume a use, never create a journal intent and never authorise an effect. An APPROVED outcome may be issued only by an authenticated principal holding current Founder authority at the moment of issuance.

*Sharpened by FE-1.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-F |
| persistence | PR-F |
| test | PR-F |

Introduced in PR-F; inherited by PR-G, PR-H, PR-I.

- `conf/A2/PR-F/approved-outcome-redeems` (positive, PR-F) — An APPROVED outcome issued by an authenticated Founder principal redeems once.
- `conf/A2/PR-F/denied-and-cancelled-authorise-nothing` (negative, PR-F) — DENIED and CANCELLED outcomes, and a resolved row with no outcome, each fail to consume a use, create an intent or authorise an effect.

### INV-A3

An authorization binds every field its action kind marks REQUIRED or FIXED, carries no field the kind marks FORBIDDEN, and satisfies every field-group constraint its kind declares, so half a provenance is refused. envelope_digest covers all twenty-four preceding fields and is an integrity and identity digest only, never a signature, a MAC or a proof of authority. A caller submits only an authorization_id or a redemption request; the runtime re-reads the immutable envelope from the authoritative database and never trusts a caller-supplied envelope on the strength of a matching digest.

*Sharpened by FE-1, FE-2, D16.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-F |
| persistence | PR-F |
| test | PR-F |

Introduced in PR-F; inherited by PR-G, PR-H, PR-I.

- `conf/A3/PR-F/envelope-reread-from-store` (positive, PR-F) — Redemption reads the stored envelope and ignores any envelope supplied by the caller.
- `conf/A3/PR-F/caller-supplied-envelope-refused` (negative, PR-F) — A caller-supplied envelope with a self-consistent digest, and an envelope missing a REQUIRED or carrying a FORBIDDEN field, are both refused.
- `conf/A3/PR-F/provenance-group-none-or-whole` (positive, PR-F) — A staging_write, production_write or worker_dispatch envelope with no Git provenance, and one with repository_identity, base_sha and head_sha together, are both accepted.
- `conf/A3/PR-F/isolated-head-base-or-pr-refused` (negative, PR-F) — An envelope carrying head_sha alone, base_sha alone, pr_number without repository_identity, or any other partial provenance, is refused.

### INV-A4

Any change to a bound field — head, base, target, policy revision, evidence identity, effect parameters — invalidates the authorization. Invalidation is evaluated against bound content, not identifiers: a changed evidence snapshot digest invalidates the authorization even when every row identifier is stable.

*Sharpened by FE-2, FE-3.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-F |
| persistence | PR-F |
| test | PR-D, PR-F |

Introduced in PR-F; inherited by PR-G, PR-H, PR-I.

- `conf/A4/PR-F/bound-tuple-still-current` (positive, PR-F) — An authorization redeems while every bound field still matches current state.
- `conf/A4/PR-D/content-change-under-stable-ids` (negative, PR-D) — Flipping an observation's conclusion while keeping every row id stable must invalidate the authorization.

### INV-A5

Uses are consumed by ordinal. Every action kind states its use_limit disposition explicitly and none is inferred: merge, production_write, destructive_operation, policy_weakening and waive_finding fix use_limit = 1; staging_write and worker_dispatch require an explicit positive integer bounded above by a named policy parameter, and an implementation-chosen ceiling such as the largest representable integer does not satisfy that bound. Expiry is evaluated on the authoritative clock at redemption.

*Sharpened by FE-2, D16.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-F |
| persistence | PR-F |
| test | PR-F |

Introduced in PR-F; inherited by PR-H, PR-I.

- `conf/A5/PR-F/ordinals-are-consumed-once` (positive, PR-F) — A staging_write authorization with use_limit 3 yields exactly three distinct redemption identities.
- `conf/A5/PR-F/absent-use-limit-is-refused` (negative, PR-F) — A staging_write envelope with no use_limit is refused rather than defaulted, and a fixed-limit kind carrying use_limit greater than 1 is refused.
- `conf/A5/PR-F/use-limit-above-the-named-maximum-refused` (negative, PR-F) — A staging_write or worker_dispatch use_limit above worker_dispatch.max_use_limit, or equal to the largest representable integer, is refused.

### INV-A6

Current state is re-validated immediately before an external effect, inside the transaction that records the intent and consumes the use. Re-validation re-reads the stored envelope, its outcome, the policy currently in force, the recomputed current evidence snapshot, the recipient and the remaining uses, and the authenticated redeemer must equal the recorded recipient.

*Sharpened by FE-1, FE-3.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-F, PR-E |
| persistence | PR-E |
| test | PR-E, PR-F |

Introduced in PR-F; inherited by PR-H.

- `conf/A6/PR-F/revalidation-inside-the-redemption-transaction` (positive, PR-F) — Redemption, use consumption and journal intent commit as one transaction after a full re-read.
- `conf/A6/PR-F/wrong-redeemer-refused` (negative, PR-F) — A principal other than the recorded recipient cannot redeem, and stale re-read state aborts the transaction.

### INV-A7

An answer belongs to the wait that asked it. A decision from an earlier wait neither authorises nor steers a later one.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-F |
| persistence | PR-F |
| test | PR-F |

Introduced in PR-F; inherited by PR-H, PR-I.

- `conf/A7/PR-F/answer-scoped-to-its-wait` (positive, PR-F) — A decision answered in the current wait authorises the current wait.
- `conf/A7/PR-F/earlier-wait-does-not-steer-a-later-one` (negative, PR-F) — An answer recorded against an earlier wait must not authorise or route the later one.

### INV-A8

Within a wait, a refusal wins regardless of the order answers arrive; a cancellation grants nothing; an approval alongside a refusal in the same category fails closed.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-F |
| persistence | PR-F |
| test | PR-F |

Introduced in PR-F; inherited by PR-H, PR-I.

- `conf/A8/PR-F/denial-wins-in-any-order` (positive, PR-F) — Approval-then-denial and denial-then-approval both leave the action refused.
- `conf/A8/PR-F/cancellation-grants-nothing` (negative, PR-F) — A cancelled decision must not satisfy the gate it was raised for.

### INV-A9

Weakening a policy or a gate is itself a Founder-gated action requiring its own authorization, and it may act only on an operational policy explicitly marked waivable; unmarked is non-waivable. The non-waivable set — INV-A1, the Phase 0 completion gate, the Phase 1A entry gate, the Founder staging, production and destructive gates, Codex independence, global reviewer capacity 1, the exact-head review requirement and one implementation PR per lane — can be changed only by a new specification PR carrying a Founder decision, never by a runtime policy_weakening envelope. Its target is an immutable policy identity; a key path or display name is never authoritative.

*Sharpened by FE-2, D18.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-F, PR-H |
| persistence | PR-F |
| test | PR-F, PR-H |

Introduced in PR-F; inherited by PR-H.

- `conf/A9/PR-H/weakening-requires-its-own-authorization` (positive, PR-H) — A gate is weakened only under a policy_weakening authorization naming the immutable policy id.
- `conf/A9/PR-H/key-path-is-not-identity` (negative, PR-H) — An authorization naming a policy by key path or display name must not weaken the policy it appears to name.
- `conf/A9/PR-H/non-waivable-targets-refused` (negative, PR-H) — A policy_weakening authorization naming any non-waivable subject, or a policy not marked waivable, is refused.

## Family E — evidence (8)

### INV-E1

Every piece of evidence is an immutable, append-only observation bound to an exact (repository, base, head) tuple where the slot is tuple-bound, and meaningless outside it. Its content — the evidence slot identity, the evidence kind, the provider's immutable identity, the project and task identity, the tuple, the logical check key, the provider's source event identity, its trusted source generation, the status, the conclusion, the source principal and observed_at — is fixed at write and wholly covered by the content digest, so the slot identity can never live only in mutable row metadata. A state change is a new observation, never a rewrite.

*Sharpened by FE-3, D17.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-D |
| persistence | PR-D |
| test | PR-D |

Introduced in PR-D; inherited by PR-F, PR-G, PR-H.

- `conf/E1/PR-D/observations-are-append-only` (positive, PR-D) — A changed provider conclusion produces a second observation and leaves the first intact.
- `conf/E1/PR-D/observation-content-cannot-be-rewritten` (negative, PR-D) — Any attempt to update an observation's content, or to read it outside its tuple, is refused.

### INV-E2

No task becomes a merge candidate or reaches a terminal success state without CI recorded as passed for the exact current tuple, judged from the current evidence snapshot recomputed at redemption. The current observation for a slot is the one carrying the greatest trusted source generation; observed_at and database ingestion order never order provider truth and never break a tie. Two different content digests at the same generation, or no single greatest generation, make the slot CONFLICTED and it fails closed. A provider with no trusted monotonic ordering contract may not supply gate evidence at all.

*Sharpened by FE-3, D17.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-F |
| persistence | PR-D |
| test | PR-F |

Introduced in PR-F; inherited by PR-H, PR-I.

- `conf/E2/PR-F/ci-passed-at-the-current-tuple` (positive, PR-F) — Merge candidacy requires a passing CI observation for the exact current tuple.
- `conf/E2/PR-F/pending-ci-blocks-merge-readiness` (negative, PR-F) — A merge authorization granted while CI is pending must not carry the task to a terminal success state.
- `conf/E2/PR-D/conflicted-slot-fails-closed` (negative, PR-D) — Two different content digests at the same source generation, or a tie broken by observed_at, must not yield a current observation.

### INV-E3

Gating is computed over the aggregate of all findings on the tuple that carry no terminal resolution event, never over the most recent verdict.

*Sharpened by FE-3.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-D |
| persistence | PR-D |
| test | PR-D |

Introduced in PR-D; inherited by PR-F, PR-H.

- `conf/E3/PR-D/aggregate-gating` (positive, PR-D) — Merge stays blocked while any unresolved blocker or high exists on the tuple.
- `conf/E3/PR-D/latest-verdict-does-not-decide` (negative, PR-D) — A later zero-finding verdict must not unblock a tuple that still carries an unresolved blocker.

### INV-E4

A later clean verdict on the same tuple does not resolve an earlier blocking finding. A finding is resolved only by an append-only resolution event: a new tuple superseding it, or a waive_finding authorization naming it. The original finding row is never rewritten.

*Sharpened by FE-3.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-D |
| persistence | PR-D |
| test | PR-D |

Introduced in PR-D; inherited by PR-F.

- `conf/E4/PR-D/resolution-is-append-only` (positive, PR-D) — A waive_finding authorization records a resolution event and leaves the finding row unchanged.
- `conf/E4/PR-D/no-latest-verdict-wins` (negative, PR-D) — A clean verdict recorded after a blocking finding on the same tuple must not clear it.

### INV-E5

An infrastructure abort produces no verdict and consumes no completed-verdict round. This is not configurable.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-D |
| persistence | PR-D |
| test | PR-D |

Introduced in PR-D; inherited by PR-G.

- `conf/E5/PR-D/abort-consumes-no-round` (positive, PR-D) — An aborted attempt leaves the completed-verdict count unchanged.
- `conf/E5/PR-D/rule-is-not-configurable` (negative, PR-D) — No policy value can make an infrastructure abort consume a round.

### INV-E6

Abort classification comes only from a trusted reviewer or provider terminal result. A worker cannot classify its own failure as infrastructure.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-D, PR-G |
| persistence | PR-D |
| test | PR-D, PR-G |

Introduced in PR-D; inherited by PR-G.

- `conf/E6/PR-D/trusted-source-classifies` (positive, PR-D) — A provider terminal result classifies the abort.
- `conf/E6/PR-G/self-classification-refused` (negative, PR-G) — A worker report claiming its own failure is infrastructure is refused.

### INV-E7

The exact tuple that would be merged is the tuple that was reviewed: repository, base and head are all compared, never head alone.

*Sharpened by FE-3.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-F |
| persistence | PR-D |
| test | PR-F |

Introduced in PR-F; inherited by PR-H.

- `conf/E7/PR-F/reviewed-tuple-equals-merged-tuple` (positive, PR-F) — Merge proceeds only when repository, base and head all equal the reviewed tuple.
- `conf/E7/PR-F/changed-base-invalidates-review` (negative, PR-F) — Changing the base while holding the head constant must invalidate the review.

### INV-E8

Repeated provider failure is reported as an infrastructure condition after at most two attempts for one exact operation on one exact tuple — the first attempt plus at most one retry, permitted only where a trusted terminal INFRA_ABORT supports it, never concurrent, each carrying its own durable attempt identity — and never retried without bound. Before a third attempt the task becomes BLOCKED with an INFRASTRUCTURE obligation and returns to the Founder. An external effect whose outcome is UNKNOWN is excluded from this rule: it is probed by redemption key first and never blindly re-sent.

*Sharpened by D18.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-D |
| persistence | PR-D |
| test | PR-D |

Introduced in PR-D; inherited by PR-G.

- `conf/E8/PR-D/bounded-attempts` (positive, PR-D) — After the bound is reached the condition is escalated as infrastructure.
- `conf/E8/PR-D/no-unbounded-retry` (negative, PR-D) — A permanently failing provider must not be retried without bound.
- `conf/E8/PR-D/third-attempt-is-refused` (negative, PR-D) — A third attempt on one exact operation and tuple is refused and the task becomes BLOCKED with an INFRASTRUCTURE obligation.

## Family S — state (6)

### INV-S1

Task state is a closed vocabulary of exactly nine states — PENDING, READY, DISPATCHING, RUNNING, WAITING, BLOCKED, SUCCEEDED, FAILED, CANCELLED — of which SUCCEEDED, FAILED and CANCELLED are terminal. The vocabulary is enforced at the application boundary and by the database.

*Sharpened by D15.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-A, PR-B |
| persistence | PR-A |
| test | PR-A, PR-B |

Introduced in PR-A; inherited by PR-B, PR-C, PR-D, PR-E, PR-F, PR-G, PR-H, PR-I.

- `conf/S1/PR-A/closed-vocabulary-at-both-boundaries` (positive, PR-A) — Every declared state round-trips through the application and the database.
- `conf/S1/PR-A/unknown-state-refused-by-the-database` (negative, PR-A) — An unknown state string is refused by the application and, independently, by a database constraint.
- `conf/S1/PR-B/nine-states-three-terminal` (negative, PR-B) — A tenth state, or a terminal state outside SUCCEEDED, FAILED and CANCELLED, is refused at both boundaries.

### INV-S2

Every transition is explicitly permitted. There is no wildcard, catch-all or default transition: every (state, event) pair carries an explicit ALLOWED or REFUSED decision, and a terminal state has no outgoing transition. Repeating terminal work means a new task or a new attempt with its own identity, never reviving the old one.

*Sharpened by D15.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-B |
| persistence | PR-A |
| test | PR-B |

Introduced in PR-B; inherited by PR-C, PR-D, PR-E, PR-F, PR-G, PR-H, PR-I.

- `conf/S2/PR-B/permitted-transitions-only` (positive, PR-B) — Each transition in the table is accepted from its declared source state.
- `conf/S2/PR-B/unlisted-transition-refused` (negative, PR-B) — An event not listed for the current state is refused and recorded.
- `conf/S2/PR-B/no-wildcard-and-no-outgoing-terminal` (negative, PR-B) — Every (state, event) pair resolves to an explicit decision, and every event from a terminal state is refused.

### INV-S3

Multi-target transitions resolve from persisted data. A caller submits an event and may assert what it believes to be true; it never submits the target state, and an assertion that contradicts persisted facts is refused rather than obeyed.

*Sharpened by D15.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-B |
| persistence | PR-A |
| test | PR-B |

Introduced in PR-B; inherited by PR-F, PR-H.

- `conf/S3/PR-B/target-resolved-from-state` (positive, PR-B) — The destination is computed from persisted rows, not from the caller.
- `conf/S3/PR-B/caller-target-contradiction-refused` (negative, PR-B) — A caller-supplied target contradicting the computed one is refused.

### INV-S4

An interruption never clears an obligation. Waiting and blocking reasons are separately persisted obligations that the state label never overwrites; a task may hold several at once, and resolving one never clears another. Recovery restores every obligation still open, or applies the answer given during the outage.

*Sharpened by D15.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-B, PR-F |
| persistence | PR-A |
| test | PR-B, PR-F |

Introduced in PR-B; inherited by PR-F, PR-H.

- `conf/S4/PR-B/recovery-restores-the-gate` (positive, PR-B) — A task interrupted at a gate returns to that gate.
- `conf/S4/PR-F/outage-answer-is-not-lost` (negative, PR-F) — An answer given during the outage must neither be discarded nor strand the task with nothing left to answer.
- `conf/S4/PR-B/resolving-one-obligation-keeps-the-others` (negative, PR-B) — With two obligations open, resolving one leaves the other open and the task not schedulable.

### INV-S5

A crash never reads as success. A task without live authority becomes visibly blocked and re-running is an explicit decision. A task reaches SUCCEEDED only when no obligation of any kind is open, no blocking finding on the current tuple is unresolved, CI is recorded as passed for the exact current tuple, the acting principal holds a valid unexpired lease, and no effect for that task is UNKNOWN_PENDING_RECONCILIATION or ABANDONED_BY_DECISION. An effect closed by decision is not a success: it never releases an obligation, never satisfies a dependency and never advances dependent work.

*Sharpened by FE-5, D15.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-C, PR-H |
| persistence | PR-C |
| test | PR-C, PR-H |

Introduced in PR-C; inherited by PR-E, PR-H.

- `conf/S5/PR-C/crash-residue-is-visible` (positive, PR-C) — A task running with no live lease becomes visibly blocked.
- `conf/S5/PR-H/abandonment-does-not-advance-dependents` (negative, PR-H) — An entry closed by decision must not release dependent work.
- `conf/S5/PR-B/success-preconditions-are-conjunctive` (negative, PR-B) — Violating any single success precondition — an open obligation, an unresolved blocker, missing exact-tuple CI, an invalid lease, an UNKNOWN effect, an ABANDONED effect — refuses DEFINITIVE_SUCCESS.

### INV-S6

Audit history is append-only. A refusal — including every refused transition, recorded with its event, its source state and its refusal reason — a finding, or a prior state is never overwritten or erased.

*Sharpened by D15.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-A |
| persistence | PR-A |
| test | PR-A |

Introduced in PR-A; inherited by PR-B, PR-C, PR-D, PR-E, PR-F, PR-G, PR-H, PR-I.

- `conf/S6/PR-A/history-is-append-only` (positive, PR-A) — A refusal and a prior state both remain readable after later writes.
- `conf/S6/PR-A/history-rows-cannot-be-updated` (negative, PR-A) — Updating or deleting an audit row is refused by the database.
- `conf/S6/PR-B/refused-transitions-are-recorded` (negative, PR-B) — A refused transition that leaves no history row fails the check.

## Family L — authority-and-leases (8)

### INV-L1

Tasks and Lanes are persisted authority. Durable state is the source of truth.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-A |
| persistence | PR-A |
| test | PR-A |

Introduced in PR-A; inherited by PR-B, PR-C, PR-D, PR-E, PR-F, PR-G, PR-H, PR-I.

- `conf/L1/PR-A/state-survives-restart` (positive, PR-A) — Lanes, tasks and decisions are readable unchanged after a restart.
- `conf/L1/PR-A/in-memory-claim-is-not-authority` (negative, PR-A) — A value held only in process memory must not decide anything after a restart.

### INV-L2

Workers are disposable compute and never the source of truth. No workflow state lives inside one.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-C |
| persistence | PR-C |
| test | PR-C |

Introduced in PR-C; inherited by PR-G, PR-H.

- `conf/L2/PR-C/workers-are-replaceable` (positive, PR-C) — Removing and adding workers changes throughput and nothing else.
- `conf/L2/PR-C/no-state-held-in-a-worker` (negative, PR-C) — Losing a worker must not lose workflow state.

### INV-L3

Every report, decision and command carries an authenticated principal. Authority is proved by the authenticated issuance context and a durable principal record, never by a self-declared field inside the message.

*Sharpened by FE-1.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-C, PR-G |
| persistence | PR-C |
| test | PR-C, PR-G |

Introduced in PR-C; inherited by PR-D, PR-F, PR-G, PR-H.

- `conf/L3/PR-C/authenticated-principal-required` (positive, PR-C) — A registered principal's report is accepted under its authenticated identity.
- `conf/L3/PR-G/self-declared-authority-refused` (negative, PR-G) — A message asserting Founder authority in its own body, with no authenticated context, is refused.

### INV-L4

Every accepted message carries replay protection; a replayed message changes nothing.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-G |
| persistence | PR-G |
| test | PR-G |

Introduced in PR-G; inherited by PR-H.

- `conf/L4/PR-G/first-delivery-applies` (positive, PR-G) — The first delivery of a message applies exactly once.
- `conf/L4/PR-G/replay-changes-nothing` (negative, PR-G) — Re-delivering the same message changes no state and adds no duplicate effect.

### INV-L5

A lease authorises only while ACTIVE, unexpired on the authoritative clock, and held by the acting principal for that subject. A reconciliation claim and an execution claim are distinct, separately persisted claims; holding one never implies the other.

*Sharpened by FE-4, FE-6.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-C |
| persistence | PR-C |
| test | PR-C |

Introduced in PR-C; inherited by PR-E, PR-F, PR-G, PR-H.

- `conf/L5/PR-C/active-unexpired-holder-acts` (positive, PR-C) — Only the ACTIVE, unexpired holder of the subject may act.
- `conf/L5/PR-C/reconciliation-claim-is-not-an-execution-claim` (negative, PR-C) — A reconciliation claim must not permit an external write, and an expired lease must not be revived by a heartbeat.

### INV-L6

Renewal is conditional and cannot revive an expired or released lease.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-C |
| persistence | PR-C |
| test | PR-C |

Introduced in PR-C; inherited by PR-G, PR-H.

- `conf/L6/PR-C/renewal-extends-a-live-lease` (positive, PR-C) — A live lease renews under its exact holder and token.
- `conf/L6/PR-C/expired-lease-cannot-renew` (negative, PR-C) — Renewing an expired or released lease is refused.

### INV-L7

Leases are fenced by a monotonic token. A stale token cannot update authoritative state and its results are rejected on arrival. Fencing does not stop a process that has already left the database: preventing a duplicated external effect additionally requires provider idempotency, a probe or a cancellation, and a provider offering none of these may not be registered.

*Sharpened by FE-4, FE-6, FE-7.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-C |
| persistence | PR-C |
| test | PR-C, PR-E |

Introduced in PR-C; inherited by PR-E, PR-G, PR-H.

- `conf/L7/PR-C/monotonic-fencing-token` (positive, PR-C) — Every hand-over allocates a strictly greater token.
- `conf/L7/PR-C/stale-token-write-rejected` (negative, PR-C) — A write or result carrying a lower token is rejected, and the specification does not claim the stale process was stopped.

### INV-L8

All time-sensitive decisions read one authoritative injectable clock.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-A |
| persistence | PR-A |
| test | PR-A, PR-B, PR-C, PR-D, PR-E, PR-F, PR-G, PR-H, PR-I |

Introduced in PR-A; inherited by PR-B, PR-C, PR-D, PR-E, PR-F, PR-G, PR-H, PR-I.

- `conf/L8/PR-A/one-injected-clock` (positive, PR-A) — Advancing the injected clock changes expiry decisions everywhere.
- `conf/L8/PR-A/no-ambient-time-source` (negative, PR-A) — A module reading wall-clock time directly fails the check.

## Family X — external-effects (4)

### INV-X1

Every external effect is journaled as intent, a durable fenced execution claim and confirmation, each durably recorded before the next begins, and no external call may occur without a claim. UNKNOWN_PENDING_RECONCILIATION never transitions directly to EXECUTING: it is first claimed by a fenced reconciler into a distinct probe-only RECONCILING state in which external writes are forbidden.

*Sharpened by FE-4.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-E |
| persistence | PR-E |
| test | PR-E |

Introduced in PR-E; inherited by PR-F, PR-H.

- `conf/X1/PR-E/intent-claim-effect-outcome` (positive, PR-E) — The four steps are each durable before the next begins.
- `conf/X1/PR-E/unknown-cannot-execute-directly` (negative, PR-E) — A direct UNKNOWN to EXECUTING transition, and any external call without a claim, are both refused.

### INV-X2

Every external effect carries an idempotency key — redemption_key — unique per use and binding the effect parameters, and is safe to retry under that key; a retry of the same redemption always reuses its key. An action kind whose provider cannot honour that key, or offers no probe by which a prior effect can be detected, is not registrable as executable.

*Sharpened by FE-6, FE-7, D16.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-E |
| persistence | PR-E |
| test | PR-E |

Introduced in PR-E; inherited by PR-F, PR-H.

- `conf/X2/PR-E/retry-under-the-same-key` (positive, PR-E) — Retrying the same redemption reuses its key and produces one effect.
- `conf/X2/PR-E/unprobeable-provider-not-registrable` (negative, PR-E) — Registering an action kind whose provider offers no idempotency contract or no probe is refused.

### INV-X3

After a crash, every unconfirmed effect is reconciled to a definite outcome before dependent work resumes, and an ambiguous result is never recorded as failure. ABANDONED_BY_DECISION records only that the Founder stopped automatic reconciliation: it asserts neither application nor non-application, retains effect_truth = UNKNOWN, never counts as success, and leaves the target quarantined until a named remediation, compensation or proceed-under-known-risk authorization is granted.

*Sharpened by FE-4, FE-5.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-E |
| persistence | PR-E |
| test | PR-E |

Introduced in PR-E; inherited by PR-H.

- `conf/X3/PR-E/probe-drives-to-a-definite-outcome` (positive, PR-E) — A confirmed probe result moves the entry to a terminal state.
- `conf/X3/PR-E/ambiguity-is-never-failure-and-abandonment-is-never-success` (negative, PR-E) — A timeout must not record CONFIRMED_NOT_APPLIED, and an abandoned entry must not release dependent work or read as success.

### INV-X4

The decision, its state transition, its lease settlement, its use consumption and its journal intent commit together or not at all. Authorization issuance, its decision row and its wait identity likewise commit together. The external call itself lies outside that transaction, by necessity.

*Sharpened by FE-1.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-F |
| persistence | PR-E |
| test | PR-F |

Introduced in PR-F; inherited by PR-H.

- `conf/X4/PR-F/one-transaction-for-the-redemption` (positive, PR-F) — All five records commit together.
- `conf/X4/PR-F/partial-commit-impossible` (negative, PR-F) — A failure at any point leaves none of the five records, and issuance cannot land without its decision row and wait identity.

## Family R — resources-and-gates (4)

### INV-R1

Gates are monotonic. Loading configuration may change capacity; it may never weaken or clear a persisted gate. The Phase 0 completion gate and the Phase 1A entry gate are separate gates, satisfying one never satisfies the other, and both are non-waivable.

*Sharpened by FE-8, D18.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-H |
| persistence | PR-H |
| test | PR-H |

Introduced in PR-H; inherited by PR-I.

- `conf/R1/PR-H/capacity-may-change-gates-may-not` (positive, PR-H) — A configuration reload changes capacity and leaves every gate intact.
- `conf/R1/PR-H/policy-sync-cannot-ungate` (negative, PR-H) — A policy sync must not turn a gated resource ungated, and the phase gates must not satisfy one another.

### INV-R2

Provenance is preserved. A refusal, a cancellation or an unrecorded legacy gate is never upgraded, normalised or erased.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-A, PR-H |
| persistence | PR-A |
| test | PR-A, PR-H |

Introduced in PR-A; inherited by PR-C, PR-D, PR-E, PR-F, PR-G, PR-H, PR-I.

- `conf/R2/PR-A/provenance-survives-upgrade` (positive, PR-A) — Refusals and cancellations survive every migration unchanged.
- `conf/R2/PR-A/legacy-rows-are-never-invented-into-consent` (negative, PR-A) — A row that never recorded a decision must not migrate into an approval or a named category.

### INV-R3

A lane's active-PR limit counts every non-terminal task whose PR is still open, independent of workflow state.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-H |
| persistence | PR-H |
| test | PR-H |

Introduced in PR-H; inherited by PR-I.

- `conf/R3/PR-H/limit-counts-every-open-pr` (positive, PR-H) — A lane limited to one holds the second task while the first PR is open.
- `conf/R3/PR-H/blocked-states-still-count` (negative, PR-H) — A task awaiting a decision or blocked on infrastructure still counts against the limit.

### INV-R4

Resource capacity is never exceeded, and acquisition is all-or-nothing.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-H |
| persistence | PR-H |
| test | PR-H |

Introduced in PR-H; inherited by PR-I.

- `conf/R4/PR-H/capacity-is-respected` (positive, PR-H) — A resource of capacity n grants at most n leases.
- `conf/R4/PR-H/partial-acquisition-rolls-back` (negative, PR-H) — A failed multi-resource acquisition strands no slot.

## Family P — reviewer-capacity (3)

### INV-P1

Global Codex Reviewer capacity is 1 within one authority domain, measured as at most one actually in-flight reviewer invocation and not merely at most one ACTIVE database claim, held as an exclusive claim over a named singleton subject.

*Sharpened by FE-6.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-C |
| persistence | PR-C |
| test | PR-C |

Introduced in PR-C; inherited by PR-D, PR-G.

- `conf/P1/PR-C/one-claim-for-the-singleton-subject` (positive, PR-C) — Concurrent acquisitions yield exactly one holder.
- `conf/P1/PR-C/in-flight-invocation-occupies-capacity` (negative, PR-C) — An invocation still in flight must keep occupying capacity even when its database claim has expired.

### INV-P2

Reviewer ownership is taken by atomic acquisition with expiry and fencing, and a stale owner can neither act nor release another's claim. Lease expiry does not by itself release external capacity: an invocation whose owner is lost enters DRAINING and continues to occupy capacity until it is proved terminal, its cancellation is confirmed, or a provider probe confirms it is not running. A provider supporting neither a terminal probe nor cancellation holds capacity indefinitely and fails closed.

*Sharpened by FE-6.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-C |
| persistence | PR-C |
| test | PR-C |

Introduced in PR-C; inherited by PR-E, PR-G.

- `conf/P2/PR-C/expiry-is-an-explicit-transition` (positive, PR-C) — Exactly one racer performs the expiry transition and exactly one holds afterwards.
- `conf/P2/PR-C/draining-invocation-blocks-a-second-dispatch` (negative, PR-C) — With no terminal probe and no confirmed cancellation, a second reviewer must not be dispatched.

### INV-P3

The reviewer is a principal distinct from the implementation principal for that task, and reviews the complete diff.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-D, PR-G |
| persistence | PR-C |
| test | PR-D, PR-G |

Introduced in PR-D; inherited by PR-G.

- `conf/P3/PR-D/reviewer-is-a-distinct-principal` (positive, PR-D) — A verdict is accepted only from a principal other than the implementer.
- `conf/P3/PR-G/self-review-refused` (negative, PR-G) — A verdict from the implementing principal, or one scoped to less than the complete diff, is refused.

## Family M — migrations (5)

### INV-M1

A migration version merged to origin/main is immutable. The runner records a checksum of each applied version and refuses to open a database whose recorded version no longer matches its definition.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-A |
| persistence | PR-A |
| test | PR-A |

Introduced in PR-A; inherited by PR-C, PR-D, PR-E, PR-F, PR-G, PR-H.

- `conf/M1/PR-A/checksum-recorded-per-version` (positive, PR-A) — Each applied version records its checksum.
- `conf/M1/PR-A/edited-version-refuses-to-open` (negative, PR-A) — Editing an already-applied version makes the database refuse to open.

### INV-M2

Every migration after v1 ships a populated previous-version fixture and a forward upgrade test.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-C, PR-D, PR-E, PR-F, PR-G, PR-H |
| persistence | n/a — M2 constrains what each migrating slice ships, not what the database stores. |
| test | PR-C, PR-D, PR-E, PR-F, PR-G, PR-H |

Introduced in PR-C; inherited by PR-D, PR-E, PR-F, PR-G, PR-H.

- `conf/M2/PR-C/populated-fixture-upgrades` (positive, PR-C) — Each migrating slice upgrades a populated fixture of its schema predecessor.
- `conf/M2/PR-C/fresh-database-only-is-not-enough` (negative, PR-C) — A migration tested only against a fresh database fails the manifest check.

### INV-M3

Upgrades preserve every row, every reference and all provenance; referential integrity is verified before commit. Each migrating slice, beginning with PR-C, owns and ships the populated-upgrade preservation test for its own version step. PR-A defines v1 and has no predecessor to upgrade, so it owns the runner check rather than a preservation test.

*Sharpened by D19.*

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-A, PR-C, PR-D, PR-E, PR-F, PR-G, PR-H |
| persistence | PR-C, PR-D, PR-E, PR-F, PR-G, PR-H |
| test | PR-C, PR-D, PR-E, PR-F, PR-G, PR-H |

Introduced in PR-A; inherited by PR-C, PR-D, PR-E, PR-F, PR-G, PR-H.

- `conf/M3/PR-C/populated-v1-upgrades-losslessly` (positive, PR-C) — PR-C upgrades a populated v1 fixture with every row, reference and provenance preserved; each later migrating slice repeats this for its own step.
- `conf/M3/PR-C/integrity-violation-rolls-back` (negative, PR-C) — A migration that would break a reference or drop provenance rolls back and leaves the database untouched.

### INV-M4

Opening a database repeatedly is idempotent; an applied version is never re-applied.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-A |
| persistence | PR-A |
| test | PR-A |

Introduced in PR-A; inherited by PR-C, PR-D, PR-E, PR-F, PR-G, PR-H.

- `conf/M4/PR-A/repeat-open-is-idempotent` (positive, PR-A) — Opening twice applies each version once.
- `conf/M4/PR-A/applied-version-never-reruns` (negative, PR-A) — An already-applied version must not run a second time.

### INV-M5

An unrecognised schema shape aborts rather than proceeding on a guess.

| Owner | Slice |
|---|---|
| normative | PR-0 |
| enforcement | PR-A |
| persistence | PR-A |
| test | PR-A |

Introduced in PR-A; inherited by PR-C, PR-D, PR-E, PR-F, PR-G, PR-H.

- `conf/M5/PR-A/known-shape-opens` (positive, PR-A) — A recognised shape opens normally.
- `conf/M5/PR-A/unknown-shape-aborts` (negative, PR-A) — An unrecognised shape aborts instead of guessing.
