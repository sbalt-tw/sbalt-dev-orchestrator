# 09 · Decision ledger

Canonical data: [`manifests/decisions.json`](manifests/decisions.json). The expected state
of every decision is anchored in `tools/spec/anchors.ts`, so the ledger cannot quietly
downgrade one.

## Confirmed facts — not decisions

No orchestrator database, backup or persistent volume has ever existed requiring
preservation · Phase 0 uses a clean `v1` baseline with no compatibility for PR #1's
experimental schemas · a specification PR-0 merges before any implementation slice ·
Codex is independent and reviews the complete diff · a later clean verdict never clears
an earlier unresolved blocking finding · the 141 historical scenarios are triaged
KEEP / REWRITE / DROP · PR #1 stays open, unmerged and unchanged pending separate
authorisation · Phase 1A and all real integrations stay closed · reviewer capacity is 1
· one implementation PR per lane · the ledger contains **47 invariants in 8 families**.

## The ledger

| ID | Decision | State | Blocks |
|---|---|---|---|
| D1 | Approve the 47-invariant manifest and its sharpened statements | **APPROVED_AS_AMENDED** | PR-0 |
| D2 | Approve the four-role ownership matrix, PR-0 holding normative text only | **APPROVED_AS_AMENDED** | PR-0 |
| D3 | Adopt the single authority domain constraint for Phase 0 | **APPROVED_AS_AMENDED** | PR-0, PR-C |
| D4 | Approve the total order, four-column dependency table and migrations v1–v7 | **APPROVED_AS_AMENDED** | PR-0, PR-A |
| D5 | Approve the journal state machine, ambiguity policy, registrability rule and crash table | **APPROVED_AS_AMENDED** | PR-0, PR-E, PR-F |
| D6 | Approve the trust-boundary split | **APPROVED_AS_AMENDED** | PR-0, PR-D, PR-G |
| D7 | Approve the 25-field envelope, action matrix, lossless identity and evidence snapshot model | **APPROVED_AS_AMENDED** | PR-0, PR-F |
| D8 | Approve severity unification, risk-label separation, R3, R4 and the no-default disposition rule | **APPROVED_AS_AMENDED** | PR-0 |
| D9 | Approve the review budgets | **APPROVED_AS_AMENDED** | PR-0 |
| D10 | Approve the test triage method and the 141-row mapping obligation | **APPROVED_AS_AMENDED** | PR-0 |
| D11 | Authorise opening PR-0 as a specification-only PR | **APPROVED** | — |
| D12 | How to support a second independent authority domain | **DEFERRED** | a second domain |
| D13 | Whether medium and low debt from Phase 0 blocks Phase 1A | **DEFERRED** | Phase 1A |
| D14 | Where the Phase-1A provider lifecycle specification lives | **DEFERRED** | Phase 1A |
| D15 | Adopt the canonical task-state model: nine states, three terminal, obligations as a separate layer | **APPROVED** | PR-0, PR-A, PR-B |
| D16 | Add `worker_dispatch` as a seventh action kind, making the matrix 7 × 25 | **APPROVED** | PR-0, PR-E, PR-F, PR-H |
| D17 | Bind slot identity into the evidence digest, order by trusted generation, fail conflicts closed | **APPROVED** | PR-0, PR-D, PR-F |
| D18 | Fix the non-waivable set and the two-attempt infrastructure limit | **APPROVED** | PR-0, PR-D, PR-F, PR-H |
| D19 | All 22 Round-1 findings are FIX; anchors live in code | **APPROVED** | PR-0 |

D1–D10 are approved **as amended**: the amendment authority is the Binding Founder
Errata FE-1 to FE-9, recorded in [12-errata.md](12-errata.md). Where the errata and an
earlier planning artifact differ, the errata govern. D15–D19 are later Founder decisions
and take precedence over any differing earlier text, including Plan v2.2.

## A deferred decision is not satisfied by a row

Round 1 found that the Phase 1A entry gate asked only whether D13 and D14 were "decided",
which the presence of a row satisfies. A deferred decision is now closed only by a
**resolution object** carrying all four of:

`decision_id` · `outcome` (APPROVED / DENIED / CANCELLED) · `content_ref` ·
`content_version`

and any gate that consumes the decision evaluates **the consequence of that outcome**, not
its existence. See [10-gates.md](10-gates.md).

D13 and D14 are conditions of the **Phase 1A entry gate**, not of the Phase 0 completion
gate (FE-8). Phase 0 may complete with both undecided.

## Standing authorizations

| Subject | State |
|---|---|
| PR #1 closure | **NOT_AUTHORIZED** — step 5 of [11-pr1-disposition.md](11-pr1-disposition.md), requested separately |
| PR-0 merge | **NOT_AUTHORIZED** |
| Phase 1A implementation | **NOT_AUTHORIZED** |
