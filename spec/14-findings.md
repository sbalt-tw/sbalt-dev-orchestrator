# 14 · Findings and carried debt

Canonical data: [`manifests/findings.json`](manifests/findings.json).

## What the record is, and what it is not

The durable record of rounds 1–4 is the four fix-commit messages on PR #1 —
`92ccee6`, `0521578`, `019a07e`, `428ae75` — each of which enumerates the findings it
closed. Round 5 produced no fix commit; its findings are the list returned to the Founder
when the budget was exhausted.

PR #1 never persisted review findings as immutable observations. That is why some of
this record is aggregate rather than itemised, and it is precisely the defect INV-E1 and
INV-S6 exist to prevent from recurring.

## Round totals

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

## The single shape

Every round found the same defect in a new place: **absence read as consent.** A missing
outcome, a missing CI result, a missing base comparison, an expired lease, a legacy row
with no recorded decision, an unrecognised provider answer. The invariant families are
organised around that shape, and the five rounds' 42 itemised findings all map into them.

## Carried debt

| ID | Item | Disposition | Owner | Target |
|---|---|---|---|---|
| `DEBT-1` | Four medium findings from rounds 1–2 whose individual text is not recoverable from any durable artifact | DEFER | Founder | Phase 1A entry gate |
| `DEBT-2` | Review and CI reports required registration but not lease possession — a deliberate Phase-0 simplification | DEFER | PR-G | PR-G |
| `DEBT-3` | The transitional `/tmp` Codex lock is not a durable global invariant | ACCEPT | PR-0 | PR-C |

`DEBT-1` is a Founder decision, not an engineering one: whether the four must be
recovered before Phase 1A is a judgement about acceptable residual risk. The
*recurrence* is already closed — from PR-D onward every finding is an append-only
observation with a content digest, so a future round's findings cannot become
unrecoverable.

`DEBT-3` is accepted rather than deferred because the mechanism is knowingly weaker than
the invariant and is scheduled to disappear when PR-C lands. The specification does not
claim it satisfies INV-P1 or INV-P2 (FE-6).
