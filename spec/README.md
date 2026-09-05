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
| Authority | Founder decisions D1–D10 approved as amended by the Binding Founder Errata; D11 approved |
| Merge | **not authorised** |
| Phase 1A | **not authorised**; every real integration stays closed |
| PR #1 | stays open, unmerged and unmodified |

## Reading order

| File | Contents |
|---|---|
| [00-model.md](00-model.md) | What the orchestrator is, the threat model, the failure model and the shared vocabulary |
| [01-invariants.md](01-invariants.md) | The 47 invariants in 8 families, with four owners each — generated from the manifest |
| [02-envelope.md](02-envelope.md) | The 25-field authorization envelope and the six-kind action matrix |
| [03-evidence.md](03-evidence.md) | Immutable observations, content digests and the snapshot recomputed at redemption |
| [04-journal.md](04-journal.md) | The effect journal, execution claims, ambiguity, reconciliation and abandonment |
| [05-leases.md](05-leases.md) | Claims, expiry, fencing, and why external capacity is not released by expiry |
| [06-review.md](06-review.md) | Severity, risk labels, budgets and the no-default disposition rule |
| [07-identity.md](07-identity.md) | Lossless canonical identity for every target the system can name |
| [08-slices.md](08-slices.md) | The total order, the four-column dependency table and migrations v1–v7 |
| [09-decisions.md](09-decisions.md) | The decision ledger D1–D14 |
| [10-gates.md](10-gates.md) | The Phase 0 completion gate and the separate Phase 1A entry gate |
| [11-pr1-disposition.md](11-pr1-disposition.md) | The strict seven-step ordering for PR #1 |
| [12-errata.md](12-errata.md) | The Binding Founder Errata FE-1 to FE-9, recorded verbatim in effect |
| [13-test-triage.md](13-test-triage.md) | How the 141 historical scenarios were triaged |
| [14-findings.md](14-findings.md) | Rounds 1–5 findings and carried debt, mapped to invariants |

## Machine-readable manifests

Everything a checker can verify mechanically lives in [`manifests/`](manifests/):

| Manifest | Carries |
|---|---|
| `invariants.json` | 47 invariants, families, four owners each, introducing and inheriting slices, named conformance and negative tests |
| `action-matrix.json` | 25 fields, 6 action kinds, 150 dispositions, group constraints |
| `slices.json` | Total order, merge / migration / schema / functional / runtime dependencies |
| `test-triage.json` | Exactly 141 rows, one per scenario at PR #1's frozen head |
| `findings.json` | Rounds 1–5 findings and carried debt, each mapped to invariants |
| `decisions.json` | D1–D14 and the standing authorizations |
| `gates.json` | The two gates, kept separate |

The manifests are the source of truth for anything countable. Where prose and a
manifest disagree, the manifest wins and the prose is a bug.

## Validating this directory

```
npm run spec:validate      # mechanical checks over every manifest and document
npm run spec:render        # regenerate 01-invariants.md from invariants.json
npm test                   # the validator's own unit and negative tests
```

`spec:validate` is a non-runtime tool. It lives in `tools/spec/`, it is excluded from
the runtime build, and nothing under `src/` may import it. That boundary is itself
tested; see [13-test-triage.md](13-test-triage.md) and `tests/spec/guards.test.ts`.
