# 05 · Claims, fencing and capacity

## Two mechanisms, deliberately separate

**Index enforcement** is a structural constraint on stable columns. **Expiry
reconciliation** is an explicit state transition performed by a statement. A partial
index whose predicate contains `now()` is not a valid index, so expiry can never be
part of one.

```sql
-- Structural: stable columns only. No time expression.
CREATE UNIQUE INDEX one_active_claim_per_subject
  ON claims(subject) WHERE status = 'ACTIVE';
```

## Acquisition

In one immediate transaction:

1. Read the current claim for the subject — for the reviewer, the singleton subject
   `reviewer:codex`.
2. If it is `ACTIVE` and `expires_at` is in the future on the authoritative clock,
   **refuse**.
3. If it is `ACTIVE` but expired, transition it to `EXPIRED` by a conditional update
   matching its holder, its fencing token and its expiry. If the update affects no row,
   someone else reconciled it first — restart.
4. Allocate a strictly increasing fencing token from a monotonic sequence.
5. Insert the new `ACTIVE` claim. The unique index makes a double grant impossible even
   under concurrency.
6. Commit.

**Renew, release, report and effect-claim** each match all five of: subject, holder
principal, `status = 'ACTIVE'`, unexpired on the authoritative clock, and the *exact*
fencing token. A stale holder therefore cannot renew, cannot act, and cannot release the
claim of the holder that displaced it. A heartbeat is a renewal and obeys the same five
conditions, so an expired claim can never be revived by one.

### Acceptance cases

* Two concurrent acquisitions of a free subject: exactly one succeeds; the other refuses
  without blocking.
* Two concurrent acquisitions racing an expired claim: exactly one performs the expiry
  transition, exactly one holds afterwards.
* A holder crashes; after expiry a new holder acquires; the revived original cannot
  renew, act or release.
* Renewal after expiry but before reconciliation: refused, and the claim is left for
  reconciliation.

## Fencing honesty

A fencing token controls what the **database** accepts. It cannot stop a process that
has already left the database. The specification therefore claims exactly this and
nothing more (FE-7):

* a stale token cannot update authoritative state;
* a result arriving under a stale token is rejected;
* preventing a duplicated *external* effect additionally requires provider idempotency,
  a probe, or cancellation;
* a provider offering none of these may not be registered.

## External capacity is not released by expiry alone

Database claims control orchestrator authority and database writes. They do not stop an
invocation that is already running elsewhere. For the Global Codex Reviewer (FE-6):

1. **Capacity 1 means at most one actually in-flight invocation** within one authority
   domain — not merely at most one `ACTIVE` row.
2. When a lease owner is lost or its lease expires, the existing invocation enters
   `DRAINING`.
3. A second reviewer is **not** dispatched until one of these holds:
   * the original invocation is proved terminal;
   * its cancellation is confirmed;
   * a provider or session probe confirms it is not running.
4. A fencing token can reject a stale result; it cannot assert that the old process
   stopped.
5. If the provider supports neither a terminal probe nor cancellation, a lost invocation
   **keeps occupying capacity** and the system fails closed.
6. The real Codex adapter does not exist before Phase 1A. Phase 0 proves this lifecycle
   contract against a fake provider.
7. The claim invariants (INV-P1, INV-P2, INV-L5, INV-L7) and any future
   provider-invocation invariant are expressed separately and must not be conflated.

## The transitional /tmp lock

Until PR-C exists, reviewer serialisation is a lock file on one host. It has no fencing,
no expiry reconciliation and no in-flight accounting. It is an operational mechanism for
the interim and the specification does **not** claim it satisfies INV-P1 or INV-P2. It is
recorded as `DEBT-3` in [`manifests/findings.json`](manifests/findings.json).

## Authority domain

Capacity 1 holds within **one authority domain**: one authoritative database and the host
that owns it. Independent hosts with no shared store do not satisfy it. Supporting a
second independent domain is deferred as D12 and is not a Phase 0 question.
