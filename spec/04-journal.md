# 04 · The effect journal

A remote effect and a local transaction cannot be atomic with each other. The journal
does not claim otherwise; it makes the effect **claimed, idempotent and reconcilable**,
which is the strongest property available.

## Three identities

| Identity | Value | Scope |
|---|---|---|
| authorization identity | `authorization_id` + `envelope_digest` | What was authorised. Stable for the life of the envelope. |
| redemption identity | `(authorization_id, use_ordinal)` | One particular use of it. |
| effect identity | `redemption_key` | What is handed to the provider for idempotency. |

```
redemption_key = sha256(
    canonical_v1(
        authorization_id,
        use_ordinal,
        action_kind,
        canonical_target,
        effect_parameters_digest ) )
```

* `use_ordinal` is allocated **inside the same transaction that consumes the use**,
  never before and never after.
* `UNIQUE(authorization_id, use_ordinal)` — an ordinal is issued once.
* `UNIQUE(redemption_key)` — one effect identity, one journal row.
* `use_limit = 1` fixes the ordinal at 1; a permitted count above 1 yields a distinct
  key per legitimate use.
* A retry of the *same* redemption always reuses its key; that is what makes the retry
  safe.
* `issued_at` is **never** a uniqueness source.
* `effect_parameters_digest` is inside the key, so one authorization and one key cannot
  execute different content.

## States

| State | Terminal | Meaning |
|---|---|---|
| `INTENT` | no | Redemption committed. The use is spent. No external call attempted. |
| `EXECUTING` | no | An executor holds a durable fenced execution claim. Exactly one principal may call the provider. |
| `RECONCILING` | no | A fenced reconciler holds a **probe-only** claim. External writes are forbidden in this state. |
| `CONFIRMED_SUCCEEDED` | yes | The provider confirmed the effect was applied. |
| `CONFIRMED_NOT_APPLIED` | yes | The provider confirmed it was *not* applied, definitively. |
| `UNKNOWN_PENDING_RECONCILIATION` | no | Timeout, connection loss, crash, or an unrecognised provider response. Dependent work stays blocked. |
| `ABANDONED_BY_DECISION` | yes for automation | The Founder stopped automatic reconciliation. See below — this is not a success. |

## Sequence

1. **Redemption transaction.** Re-read and re-validate every binding against current
   state; recompute and verify the current evidence snapshot (§03); allocate
   `use_ordinal` and consume the use; write the journal row in `INTENT`; commit.
2. **Executor claim transaction.** Conditional transition `INTENT → EXECUTING`,
   recording the executor principal, its claim and its fencing token; commit. Only the
   holder of a valid claim may proceed, and **no external call may occur without one**.
3. **External effect — outside any transaction.** Executed with the `redemption_key`.
   This is the only step the database cannot bound.
4. **Outcome transaction.** A definitive provider result records
   `CONFIRMED_SUCCEEDED` or `CONFIRMED_NOT_APPLIED`. Anything else records
   `UNKNOWN_PENDING_RECONCILIATION`.
5. **Reconciliation.** A reconciler takes its own fenced claim, moves the entry to
   `RECONCILING`, probes by `redemption_key`, and drives it to a terminal state — or
   leaves it non-terminal and blocked. Idempotent under repetition.

## Ambiguity policy

A timeout, a dropped connection, a process crash, or a provider response the adapter
does not recognise **must never** be recorded as `CONFIRMED_NOT_APPLIED`. Only a
positive provider assertion of non-application is definitive. Everything else is
`UNKNOWN_PENDING_RECONCILIATION`.

## UNKNOWN cannot execute directly

The transition `UNKNOWN_PENDING_RECONCILIATION → EXECUTING → external call` is
forbidden (FE-4). The permitted path is:

1. A fenced reconciler claims the entry into `RECONCILING`, in which external writes
   are impossible.
2. The reconciler probes by `redemption_key`.
3. Probe confirms applied → `CONFIRMED_SUCCEEDED`.
4. Probe confirms not applied **and** the provider contract proves same-key retry is
   safe → a **new** fenced execution attempt may be created, and only then does the
   entry enter `EXECUTING`.
5. Probe still unknown → back to `UNKNOWN_PENDING_RECONCILIATION`, still blocked.
6. Nothing is re-sent before a probe.

The reconciliation claim and the execution claim are distinct, separately persisted
claims. Holding one never implies the other.

## Abandonment is not success

`ABANDONED_BY_DECISION` (FE-5):

1. means only that the Founder stopped automatic reconciliation;
2. does **not** assert the effect was applied;
3. does **not** assert it was not applied;
4. is never counted as successful completion;
5. never advances dependent work automatically;
6. leaves the target **quarantined and blocked** unless the Founder separately approves
   a named remediation, compensation, or proceed-under-known-risk action;
7. retains `effect_truth = UNKNOWN` in the audit record;
8. does not satisfy the Phase 0 completion gate. Renaming UNKNOWN to ABANDONED is not
   determining an outcome.

## Registrability

An action kind whose provider offers no provable idempotency contract, or no probe by
which a prior effect can be detected, **must not be registered as executable**. For such
a provider the system makes no exactly-once and no safe-retry claim, and the action is
unavailable rather than attempted optimistically. In Phase 0 the only registered effect
is fake-worker dispatch, whose probe is a lookup for a lease bearing the redemption key.

## Crash points

| Point | Crash occurs | Durable state | Reconciliation |
|---|---|---|---|
| C1 | Before the redemption commit | Nothing. No intent, no consumed use. | None required; the request may be made again. |
| C2 | After redemption, before the executor claim | `INTENT`; use consumed. | Any executor may take the claim. No external call has happened. |
| C3 | After the claim, before the provider call | `EXECUTING`, stale claim. | The claim expires; a reconciler takes a new fenced claim. The old executor is fenced out. Probe, then execute or confirm. |
| C4 | During the provider call | `EXECUTING`; outcome unknown. | Probe by `redemption_key`. Applied ⇒ `CONFIRMED_SUCCEEDED`. Definitively absent **and** retry-safe ⇒ new attempt under the same key. Still uncertain ⇒ remain `UNKNOWN_PENDING_RECONCILIATION`, blocked. |
| C5 | After the effect, before the outcome commit | `EXECUTING`; the world has moved. | Probe finds the effect and records success. Never re-executed blindly. |
| C6 | During reconciliation itself | Whatever C2–C5 left. | Re-run; reconciliation is idempotent and the fencing token prevents two reconcilers colliding. |

An entry in any non-terminal state blocks dependent work for its target. Nothing is
assumed complete, and no ambiguity is resolved by inference.
