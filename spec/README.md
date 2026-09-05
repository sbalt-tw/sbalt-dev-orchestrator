# SBALT Development Orchestrator — Phase 0 canonical specification

This directory is the canonical specification for Phase 0 of the SBALT Development
Orchestrator. It supersedes every planning artifact that preceded it. Nothing here
requires the reader to reassemble a plan document, a PDF or a conversation: if a rule
is not written down in this directory, it is not part of the specification.

## Status

| | |
|---|---|
| Slice | **PR-0**, specification-only |
| Runtime source | none — PR-0 ships no `src/`, no schema and no migration |
| Authority | D1–D10 approved as amended by the Binding Founder Errata; D11 and D15–D19 approved |
| Merge | **not authorised** |
| Phase 1A | **not authorised**; every real integration stays closed |
| PR #1 | stays open, unmerged and unmodified |

## Reading order

| File | Contents |
|---|---|
| [00-model.md](00-model.md) | What the orchestrator is, the threat model, the failure model and the shared vocabulary |
| [01-invariants.md](01-invariants.md) | The 47 invariants in 8 families, with four owners each — generated from the manifest |
| [02-envelope.md](02-envelope.md) | The 25-field authorization envelope and the seven-kind action matrix |
| [03-evidence.md](03-evidence.md) | Immutable observations, slot identity, ordering by trusted generation, conflict |
| [04-journal.md](04-journal.md) | The effect journal, execution claims, ambiguity, reconciliation and abandonment |
| [05-leases.md](05-leases.md) | Claims, expiry, fencing, and why external capacity is not released by expiry |
| [06-review.md](06-review.md) | Severity, risk labels, budgets and the no-default disposition rule |
| [07-identity.md](07-identity.md) | Lossless canonical identity for every target the system can name |
| [08-slices.md](08-slices.md) | The total order, the four-column dependency table and migrations v1–v7 |
| [09-decisions.md](09-decisions.md) | The decision ledger D1–D19 |
| [10-gates.md](10-gates.md) | The Phase 0 completion gate and the separate Phase 1A entry gate |
| [11-pr1-disposition.md](11-pr1-disposition.md) | The strict seven-step ordering for PR #1 |
| [12-errata.md](12-errata.md) | The Binding Founder Errata FE-1 to FE-9 |
| [13-test-triage.md](13-test-triage.md) | How the 141 historical scenarios were triaged |
| [14-findings.md](14-findings.md) | Findings and carried debt, from both reviews, mapped to invariants |
| [15-task-state.md](15-task-state.md) | The nine states, the obligation layer and the total transition table |
| [16-non-waivable.md](16-non-waivable.md) | What may never be weakened, and the two-attempt infrastructure limit |

## Machine-readable manifests

Everything a checker can verify mechanically lives in [`manifests/`](manifests/):

| Manifest | Carries |
|---|---|
| `invariants.json` | 47 invariants, families, four owners each, lineage, named conformance and negative tests |
| `action-matrix.json` | 25 fields, 7 action kinds, 175 dispositions, group constraints |
| `slices.json` | Total order, merge / migration / schema / functional / runtime dependencies |
| `task-state.json` | 9 states, 13 events, 117 explicit cells, obligations, success preconditions |
| `evidence-model.json` | Content fields, ordering by trusted generation, conflict rules |
| `policy-parameters.json` | Named bounded parameters and the infrastructure retry rule |
| `non-waivable.json` | The ten subjects no runtime envelope may weaken |
| `test-triage.json` | Exactly 141 rows, one per scenario at PR #1's frozen head |
| `findings.json` | Rounds 1–5 of PR #1, round 1 of PR-0, and carried debt |
| `decisions.json` | D1–D19 and the standing authorizations |
| `gates.json` | The two gates, kept separate and both non-waivable |
| `pr1-ordering.json` | The seven-step PR #1 disposition as structured data |

The manifests are the source of truth for anything countable. Where prose and a
manifest disagree, the manifest wins and the prose is a bug.

## What checks it

`tools/spec/validate.ts` compares every manifest against **`tools/spec/anchors.ts`**, which
holds the expected values in code, deliberately separate from the data being checked. A
manifest that rewrites its own declaration of what is legal changes nothing: the anchor is
where the census, the legal states, the dispositions, the group rules, the gate conditions
and the finding identities actually live. Changing an anchor is a specification change and
carries a Founder decision reference.

`tools/spec/fixtures.ts` holds one mutation per failure class. The validator **executes
every fixture** and reports `NEGATIVE_FIXTURE_INERT` if one of them fails to turn its check
red, so a guard that has never been seen to fire cannot survive here.

```
npm run spec:validate      # every mechanical check, plus the whole mutation matrix
npm run spec:render        # regenerate 01-invariants.md from invariants.json
npm test                   # the validator's unit, mutation and boundary tests
```

The validator is a non-runtime tool. It lives in `tools/spec/`, it is excluded from the
runtime build and from every package entry point, and nothing under `src/` may reach it —
by static import, by literal dynamic import, by a computed specifier, or by `require`.
That boundary is tested, and the mutation matrix proves each of those routes is caught.
