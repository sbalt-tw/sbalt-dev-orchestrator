# 13 · Test triage

Canonical data: [`manifests/test-triage.json`](manifests/test-triage.json) — exactly
141 rows.

## Source

The only historical source is PR #1 at its frozen head
`428ae75e91fa1dd23c371d5f7af745aba0bec7fd`. Each row is one `it()` or `test()` scenario
present in `tests/**/*.test.ts` at that head, recorded with its file, its line, and its
full `describe > name` scenario path. The count is exactly the suite size reported by
that head: **141**.

| File | Scenarios |
|---|---|
| `tests/contracts.test.ts` | 13 |
| `tests/demo.test.ts` | 7 |
| `tests/dependencies.test.ts` | 6 |
| `tests/founderGate.test.ts` | 6 |
| `tests/hardening.test.ts` | 28 |
| `tests/lanePolicy.test.ts` | 5 |
| `tests/recovery.test.ts` | 5 |
| `tests/resources.test.ts` | 5 |
| `tests/review.test.ts` | 8 |
| `tests/round4.test.ts` | 18 |
| `tests/stateMachine.test.ts` | 9 |
| `tests/upgrade.test.ts` | 25 |
| `tests/workers.test.ts` | 6 |
| **Total** | **141** |

## Dispositions

| Disposition | Count | Meaning |
|---|---|---|
| `KEEP` | 106 | The scenario's meaning is unchanged by the reset; it returns in the target slice under the same name. |
| `REWRITE` | 30 | The obligation survives but the model it asserted against does not; it returns in the target slice under a stated replacement name. |
| `DROP` | 5 | The scenario tested an artefact of PR #1 that the clean baseline never creates. |

Every row carries `source_head`, `source_file`, the scenario name, mapped invariant IDs,
a disposition, a rationale, a target slice, a replacement name where the disposition is
`REWRITE`, and an audit note.

## Rules

* **No estimation, and no file-level mapping.** One row per scenario.
* A duplicate row, a missing row, or an unknown disposition fails the validator.
* Every `DROP` carries a reason, and is permitted only when the invariants named on that
  row carry the obligation in their own conformance tests.
* Every `REWRITE` carries a target slice and a planned replacement test identity.
* **New tests are not listed here.** Added conformance tests are declared in
  `invariants.json`; this manifest describes only the 141 historical scenarios, so a new
  test can never be disguised as a surviving one.
* **"A previous review did not object to it" is never a reason to KEEP.** Every KEEP
  rationale states what about the scenario's meaning is unchanged.

## Why five scenarios are dropped

All five (rows 87, 89, 115, 116, 117) upgrade from, or repair, PR #1's own version 2
schema and its `legacy_unknown` resource category. Phase 0 starts from a clean `v1`
baseline, so those shapes are never created and no database will ever be in them. The
obligations they protected — a row that never recorded a decision must not become
consent, a category must never be invented, an approval in one category must not
authorise another — are carried by INV-R2, INV-A2, INV-M5 and INV-A3, each of which has
its own negative conformance test. Dropping the five therefore leaves no invariant
uncovered, which is the only condition under which a drop is permitted.
