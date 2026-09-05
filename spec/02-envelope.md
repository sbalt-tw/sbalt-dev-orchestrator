# 02 · The authorization envelope

Canonical data: [`manifests/action-matrix.json`](manifests/action-matrix.json).
That manifest is the source of truth for the field list, the six action kinds and all
150 dispositions. This document states the rules the manifest cannot express.

## Twenty-five fields

The envelope has exactly twenty-five discrete fields. Seventeen are REQUIRED in every
action kind:

`schema_version` · `authorization_id` · `action_kind` · `project_id` · `lane_id` ·
`task_id` · `wait_id` · `decision_id` · `target_identity` · `effect_parameters_digest` ·
`policy_revision` · `outcome` · `issuer` · `recipient` · `issued_at` · `expires_at` ·
`envelope_digest`

Phase 0 authorizations are task-scoped without exception, which is why `lane_id` and
`task_id` are never optional. The remaining eight fields — `repository_identity`,
`pr_number`, `base_sha`, `head_sha`, `artifact_digest`, `evidence_snapshot_ref`,
`use_limit`, `justification` — carry a stated disposition in each of the six kinds.
Every field appears exactly once in every kind, so the matrix is total by
construction: 6 × 25 = 150 cells, each holding exactly one of REQUIRED, FIXED,
OPTIONAL or FORBIDDEN.

## The digest is not a signature

`envelope_digest` is sha256 over the versioned canonical serialization of the
twenty-four preceding fields. It proves *integrity and identity*: that this envelope is
the one it claims to be and has not been altered. It proves nothing about who made it.

Therefore (FE-1):

1. A caller may submit only an `authorization_id` or a redemption request.
2. The runtime **re-reads the immutable envelope from the authoritative database**.
3. A caller-supplied envelope is never trusted because its digest verifies.
4. Redemption verifies the stored digest, the current state, the policy currently in
   force, the recomputed current evidence snapshot, the recipient, and the remaining uses.
5. The authenticated redeemer must equal the recorded `recipient`.
6. Only `outcome = APPROVED` may be redeemed. `DENIED` and `CANCELLED` never consume a
   use, never create a journal intent and never authorise an effect.
7. An `APPROVED` outcome may be issued only by an authenticated principal holding
   current Founder authority at that moment. The `issuer` field records that principal;
   it does not confer the authority.
8. Issuance of the envelope, its decision row and its wait identity commit together or
   not at all.

## use_limit is never inferred

`use_limit` has an explicit disposition in every kind (FE-2):

| Kind | `use_limit` |
|---|---|
| `merge` | FIXED 1 |
| `production_write` | FIXED 1 |
| `destructive_operation` | FIXED 1 |
| `policy_weakening` | FIXED 1 |
| `waive_finding` | FIXED 1 |
| `staging_write` | **REQUIRED**, an explicit positive integer |

`staging_write` is the only kind with a caller-chosen use count, and omitting it is a
refusal, not a default of one.

## Git provenance is a group, not four fields

For `staging_write` and `production_write` the four provenance fields form one
structured group (FE-2):

* Supplying **none** of them is permitted.
* Supplying **any** of them requires `repository_identity`, `base_sha` and `head_sha`
  together.
* `pr_number` may be supplied only when `repository_identity` is present.
* An isolated head, base or PR number is refused.

Where the group's members are FORBIDDEN — `destructive_operation` forbids
`pr_number`, `base_sha` and `head_sha`; `policy_weakening` forbids all four — no
isolated provenance can arise.

## Canonical targets

| Kind | `target_identity` |
|---|---|
| `merge` | `git:<repository_identity>#<byte-exact full ref>` |
| `staging_write` | `env:<immutable environment id>` |
| `production_write` | `env:<immutable environment id>` |
| `destructive_operation` | `resource:<stable immutable resource id>` |
| `policy_weakening` | `policy:<immutable policy id>` |
| `waive_finding` | `finding:<stable immutable finding id>` |

A policy key path or display name is never authoritative identity (FE-2). The identity
rules are in [07-identity.md](07-identity.md) and the two documents must agree; the
validator checks that they do.

## Refusal is total

An envelope missing a REQUIRED field, carrying a FORBIDDEN field, violating a group
constraint, failing its digest, or naming an unrecognised `schema_version` is
**refused**. It is never partially honoured and the offending field is never ignored.
