# 08 · Slices, dependencies and migrations

Canonical data: [`manifests/slices.json`](manifests/slices.json).

## Total order

`PR-0` → `PR-A` → `PR-B` → `PR-C` → `PR-D` → `PR-E` → `PR-F` → `PR-G` → `PR-H` → `PR-I`

One implementation PR per lane. The **merge predecessor** is always the immediately
preceding slice, which is what enforces that.

## Four columns

| # | Slice | Merge predecessor | Migration | Schema predecessor | Functional dependencies | Runtime dependencies |
|---|---|---|---|---|---|---|
| 1 | PR-0 Specification | — | none | — | — | — |
| 2 | PR-A Durable core | PR-0 | `v1` | — (defines v1) | PR-0 manifest | clock |
| 3 | PR-B State machine | PR-A | none | `v1` | PR-A | store, clock |
| 4 | PR-C Principals and leases | PR-B | `v2` | `v1` | PR-A, PR-B | store, clock, engine |
| 5 | PR-D Evidence and verdicts | PR-C | `v3` | `v2` | PR-A, PR-B, PR-C | store, engine, principals |
| 6 | PR-E Effect journal | PR-D | `v4` | `v3` — **PR-D** | PR-C, PR-D | store, clock, principals |
| 7 | PR-F Authorization envelope | PR-E | `v5` | `v4` | PR-C, PR-D, PR-E | leases, evidence, journal, engine |
| 8 | PR-G Report ingestion | PR-F | `v6` | `v5` | PR-C, PR-D, PR-F | principals, evidence, authorization |
| 9 | PR-H Scheduler | PR-G | `v7` | `v6` | PR-C, PR-E, PR-F, PR-G | all of the above |
| 10 | PR-I Operator surface | PR-H | none | `v7` | PR-A … PR-H | all |

Functional dependencies are a subset of the merge predecessors and never point forward,
so the graph stays acyclic. Migration versions advance by exactly one per migrating
slice, and each ships a populated fixture of its schema predecessor with a forward
upgrade test.

PR-E's schema predecessor is `v3`, which PR-D produces; PR-D is therefore both its merge
predecessor and its schema predecessor, and PR-E's functional dependencies name PR-D
explicitly for that reason.

## Migration discipline

* A version merged to `origin/main` is immutable. Correcting it means a new version.
* The runner records a checksum per applied version and refuses to open a database whose
  recorded version no longer matches its definition.
* A rebuild disables foreign keys **outside** the transaction, holds
  `legacy_alter_table` during the rebuild, and runs `foreign_key_check` before
  committing. `PRAGMA defer_foreign_keys` delays the check but does not permit dropping
  a referenced parent, and `PRAGMA foreign_keys` is a no-op inside a transaction.
* Testing only against a fresh database does not test a migration. Every migrating slice
  upgrades a **populated** fixture of its schema predecessor.
* An unrecognised schema shape aborts rather than proceeding on a guess.

## Clean baseline

Phase 0 starts from a clean `v1`. No database, backup or persistent volume from PR #1
exists or requires preservation, and no compatibility is offered for PR #1's
experimental schemas. This is the premise that makes five of the 141 historical
scenarios droppable; see [13-test-triage.md](13-test-triage.md).
