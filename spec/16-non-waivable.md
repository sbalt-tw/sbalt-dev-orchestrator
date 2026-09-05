# 16 · Non-waivable rules and the attempt limit

Authority: **D18**. Canonical data:
[`manifests/non-waivable.json`](manifests/non-waivable.json) and
[`manifests/policy-parameters.json`](manifests/policy-parameters.json).

## What may be weakened

A `policy_weakening` authorization may act **only** on an operational policy that the
policy document in force explicitly marks **waivable**.

**Unmarked is non-waivable.** The absence of a waivable marking is not permission
(INV-A1).

## What may never be weakened

| | Subject |
|---|---|
| NW-1 | INV-A1 — absence is never consent |
| NW-2 | The Phase 0 completion gate |
| NW-3 | The Phase 1A entry gate |
| NW-4 | The Founder staging-write gate |
| NW-5 | The Founder production-write gate |
| NW-6 | The Founder destructive-operation gate |
| NW-7 | Codex independence — the reviewer is a principal distinct from the implementer |
| NW-8 | Global Codex reviewer capacity = 1 |
| NW-9 | The exact-head review requirement |
| NW-10 | One implementation PR per lane |

Changing any of these requires a **new specification PR carrying a Founder decision**. There
is no runtime envelope that can do it. This closes the contradiction Round 1 found between
INV-A9, which permits weakening a gate, and INV-R1, which requires gates to stand: A9 now
states its own scope, and both phase gates carry `waivable: false`.

## The infrastructure attempt limit

`infrastructure.max_attempts_per_operation = 2`, non-waivable.

For one exact operation on one exact tuple:

* **Two attempts total**: the first, plus at most one retry.
* A retry is permitted only where the previous attempt ended in a **trusted terminal
  `INFRA_ABORT`**, classified by a reviewer or provider — never self-classified by a worker
  (INV-E6).
* Retries are **never concurrent**: at most one attempt for an operation is in flight.
* Each attempt carries its own **durable attempt identity**.
* Before a third attempt the task becomes `BLOCKED` with an `INFRASTRUCTURE` obligation and
  returns to the Founder.
* An infrastructure abort **consumes no completed-verdict round** (INV-E5).

"A bounded number of attempts" is no longer a phrase: it is the number 2, under a named
key. An implementation-chosen ceiling such as the largest representable integer is
technically bounded and does not satisfy this.

### Unknown effects are excluded

This retry rule does **not** apply to an external effect whose outcome is `UNKNOWN`. Such
an effect is never blindly re-sent. It is probed by `redemption_key` first, and re-executed
only when the probe confirms non-application **and** the provider contract proves same-key
retry is safe ([04-journal.md](04-journal.md)).

## Other bounded parameters

| Key | Value | Maximum | Waivable |
|---|---|---|---|
| `worker_dispatch.max_use_limit` | 16 | 16 | no |
| `infrastructure.max_attempts_per_operation` | 2 | 2 | no |
| `review.completed_verdict_rounds.default` | 2 | 3 | no |

Every parameter states a finite maximum. A parameter without one is not bounded, and the
validator refuses it.
