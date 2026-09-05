# 02 · The authorization envelope

Canonical data: [`manifests/action-matrix.json`](manifests/action-matrix.json).
That manifest carries the field list, the seven action kinds and all 175 dispositions; the
expected values are anchored independently in `tools/spec/anchors.ts`, so the manifest
cannot widen its own contract. This document states the rules the manifest cannot express.

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
`use_limit`, `justification` — carry a stated disposition in each of the seven kinds.
Every field appears exactly once in every kind, so the matrix is total by construction:
7 × 25 = 175 cells, each holding exactly one of REQUIRED, FIXED, OPTIONAL or FORBIDDEN.

## The seven kinds

| Kind | Acts on | Canonical target |
|---|---|---|
| `merge` | a reviewed tuple | `git:<repository_identity>#<byte-exact full ref>` |
| `staging_write` | a staging environment | `env:<immutable environment id>` |
| `production_write` | production | `env:<immutable environment id>` |
| `destructive_operation` | an irreversible resource operation | `resource:<stable immutable resource id>` |
| `policy_weakening` | a waivable operational policy | `policy:<immutable policy id>` |
| `waive_finding` | one finding on one tuple | `finding:<stable immutable finding id>` |
| `worker_dispatch` | dispatching a worker to one task | `worker:<immutable provider identity>` |

### worker_dispatch (D16)

Phase 0's only registered external effect is dispatching a worker. Round 1 found that it
was not one of the action kinds at all, so no redemption key could be constructed for it
without inventing or borrowing a kind. It is now a kind of its own.

* The name describes the **act**, not the Phase-0 provider. The fake worker is the only
  registered provider in Phase 0; the kind is not named for it.
* The Founder issues **one task-scoped, bounded authorization**. The scheduler then
  redeems it **per use ordinal** to dispatch a dynamic worker. Dispatching a worker is not
  a fresh question to the Founder each time; exceeding the authorised count is.
* Each ordinal yields its own redemption identity, and a retry of the same redemption
  reuses the same `redemption_key`.
* It binds project, lane and task, the immutable provider identity, the recipient, the
  policy revision, the expiry and the effect parameters digest.
* It authorises **dispatch only**: never a merge, a staging or production write, a
  destructive operation or a policy weakening.
* `evidence_snapshot_ref` is FORBIDDEN. A dispatch is authorised by decision, not by
  evidence: nothing has been produced yet to attest.

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

`use_limit` has an explicit disposition in every kind (FE-2, D16):

| Kind | `use_limit` |
|---|---|
| `merge` | FIXED 1 |
| `production_write` | FIXED 1 |
| `destructive_operation` | FIXED 1 |
| `policy_weakening` | FIXED 1 |
| `waive_finding` | FIXED 1 |
| `staging_write` | **REQUIRED**, an explicit positive integer |
| `worker_dispatch` | **REQUIRED**, an explicit positive integer |

The two caller-chosen counts are bounded above by the named policy parameter
`worker_dispatch.max_use_limit` ([16-non-waivable.md](16-non-waivable.md)). An
implementation-chosen ceiling such as the largest representable integer is technically
bounded and does not satisfy the bound. Omitting `use_limit` where it is REQUIRED is a
refusal, not a default of one.

## Git provenance is a group, not four fields

For `staging_write`, `production_write` and `worker_dispatch` the four provenance fields
form one structured group (FE-2):

* Supplying **none** of them is permitted.
* Supplying **any** of them requires `repository_identity`, `base_sha` and `head_sha`
  together.
* `pr_number` may be supplied only when `repository_identity` is present.
* An isolated head, base or PR number is refused. Half a provenance is never accepted.

INV-A3 carries this rule and names both of its conformance tests:
`conf/A3/PR-F/provenance-group-none-or-whole` and
`conf/A3/PR-F/isolated-head-base-or-pr-refused`. Where the group's members are FORBIDDEN —
`destructive_operation` forbids `pr_number`, `base_sha` and `head_sha`; `policy_weakening`
forbids all four — no isolated provenance can arise.

## Refusal is total

An envelope missing a REQUIRED field, carrying a FORBIDDEN field, violating a group
constraint, failing its digest, or naming an unrecognised `schema_version` is
**refused**. It is never partially honoured and the offending field is never ignored.
