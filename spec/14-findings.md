# 14 · Findings and carried debt

Canonical data: [`manifests/findings.json`](manifests/findings.json). The five PR #1
rounds, their 42 finding identities, the three debt identities, the 22 PR-0 Round-1
findings and the Round-1 verdict are all anchored in `tools/spec/anchors.ts`, so emptying
a collection no longer passes.

## PR #1, rounds 1–5

The durable record of rounds 1–4 is the four fix-commit messages on PR #1 —
`92ccee6`, `0521578`, `019a07e`, `428ae75` — each of which enumerates the findings it
closed. Round 5 produced no fix commit; its findings are the list returned to the Founder
when the budget was exhausted.

PR #1 never persisted review findings as immutable observations. That is why some of
this record is aggregate rather than itemised, and it is precisely the defect INV-E1 and
INV-S6 exist to prevent from recurring.

| Round | Head | Verdict | Itemised | Unitemised |
|---|---|---|---|---|
| 1 | `c37af33` | 0 B / 9 H / 3 M | 9 | 3 |
| 2 | `92ccee6` | 0 B / 9 H / 2 M | 10 | 1 |
| 3 | `0521578` | 3 B / 3 H | 6 | 0 |
| 4 | `019a07ea` | 3 C / 6 H | 9 | 0 |
| 5 | `428ae75` | 1 C / 6 H / 1 M | 8 | 0 |

Round 5 reported `CRITICAL`; under the unified vocabulary of
[06-review.md](06-review.md) those are `BLOCKER`. The original words are retained in the
manifest because it is a historical record.

Round 2's durable record enumerates ten repairs against an eleven-finding verdict, and
round 1's enumerates nine against twelve. Per-item severity attribution is therefore not
recoverable for round 2, and four findings exist only in aggregate. They are **not
silently dropped**: they are `DEBT-1`.

## PR-0, round 1

The first review of this specification returned **BLOCKED — 6 BLOCKER, 8 HIGH, 6 MEDIUM,
2 LOW** at head `88b7a77f544d70a01697342ed8bcd74fdcaa395e` over base
`855ff2b3b139ad8f17fd04118fa5ec090616a24b`. D19 dispositions all 22 as **FIX**: no ACCEPT,
no DEFER, no waiver. Each is recorded in the manifest with the decision that closed it and
what the closure actually was.

Three were **specification gaps** — rules the specification lacked rather than implemented
wrongly — and under R6 those returned to the Founder rather than being patched inside the
round. They became D15 (the task-state model), D16 (`worker_dispatch`) and D17 (evidence
slot identity, ordering and conflict).

The rest divide into two groups. One is the validator reading its expectations out of the
same manifests it was checking: the census, the legal states, the dispositions and the
field groups were all declared in the data being validated, so editing a declaration
disabled the check. That is now closed by `tools/spec/anchors.ts`, which holds every
expected value in code. The other is prose that had drifted from its own rules — a gate
satisfied by the thing it was meant to reject, an errata map that claimed more than it
did, a fencing guarantee stronger than a database can give.

## The single shape

Every round of both reviews found the same defect in a new place: **absence read as
consent.** A missing outcome, a missing CI result, a missing base comparison, an expired
lease, a legacy row with no recorded decision, an unrecognised provider answer, an
abandoned effect that satisfied a gate, an empty array that satisfied a checker. The
invariant families are organised around that shape.

## Carried debt

| ID | Item | Disposition | Owner | Target |
|---|---|---|---|---|
| `DEBT-1` | Four medium findings from rounds 1–2 whose individual text is not recoverable from any durable artifact | DEFER | Founder | Phase 1A entry gate |
| `DEBT-2` | A review or CI report must hold an active claim, not merely be registered | **FIX** | PR-G | PR-G |
| `DEBT-3` | The transitional `/tmp` Codex lock is not a durable global invariant | ACCEPT | PR-0 | PR-C |

`DEBT-1` is a Founder decision, not an engineering one: whether the four must be
recovered before Phase 1A is a judgement about acceptable residual risk. The
*recurrence* is already closed — from PR-D onward every finding is an append-only
observation with a content digest.

`DEBT-2` used to say PR-G would decide the rule and that its replacement test should assert
"whatever PR-G decides". That is not a testable obligation, and it reintroduced exactly the
default the specification forbids. The rule is now fixed, fail-closed: a report carrying a
verdict, a CI conclusion or any other evidence must come from a principal that is
registered **and** holds an active, unexpired claim for that subject. PR-G implements it
rather than deciding it, and DEBT-2 closes when its two named tests pass — not when PR-G
picks a different answer.

`DEBT-3` is accepted rather than deferred because the mechanism is knowingly weaker than
the invariant and is scheduled to disappear when PR-C lands. The specification does not
claim it satisfies INV-P1 or INV-P2 (FE-6).
