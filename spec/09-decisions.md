# 09 · Decision ledger

Canonical data: [`manifests/decisions.json`](manifests/decisions.json).

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
| D11 | Authorise opening PR-0 as a specification-only PR including its non-runtime validator, tests and CI wiring | **APPROVED** | — |
| D12 | How to support a second independent authority domain | **DEFERRED** | a second domain |
| D13 | Whether medium and low debt from Phase 0 blocks Phase 1A | **DEFERRED** | Phase 1A |
| D14 | Where the Phase-1A provider lifecycle specification lives | **DEFERRED** | Phase 1A |

D1–D10 are approved **as amended**: the amendment authority is the Binding Founder
Errata FE-1 to FE-9, recorded in [12-errata.md](12-errata.md). Where the errata and an
earlier planning artifact differ, the errata govern.

D13 and D14 are conditions of the **Phase 1A entry gate**, not of the Phase 0 completion
gate (FE-8). Phase 0 may complete with both undecided.

## Standing authorizations

| Subject | State |
|---|---|
| PR #1 closure | **NOT_AUTHORIZED** — step 5 of [11-pr1-disposition.md](11-pr1-disposition.md), requested separately |
| PR-0 merge | **NOT_AUTHORIZED** |
| Phase 1A implementation | **NOT_AUTHORIZED** |
