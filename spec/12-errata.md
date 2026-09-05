# 12 · Binding Founder Errata

These nine errata carry Founder decision authority and take precedence over any
differing or ambiguous text in any earlier planning artifact. D1–D10 are approved **as
amended by** them.

They are mapped into the existing 47 invariants. **No invariant was added, removed,
merged or renumbered.** The mapping is recorded per invariant in
[`manifests/invariants.json`](manifests/invariants.json) under `errata`.

---

## FE-1 — Authorization authenticity and redemption

1. `envelope_digest` is an integrity and identity digest only — not a signature, a MAC
   or a proof of identity.
2. The runtime must not accept a caller-supplied envelope and trust it because the
   digest matches.
3. A caller may submit only an `authorization_id` or a redemption request.
4. The runtime re-reads the immutable envelope from the authoritative database.
5. It must verify the stored envelope digest, the current state, the current policy, the
   evidence snapshot, the recipient and the remaining uses.
6. An `APPROVED` outcome for a gated action may be issued only by an authenticated
   principal holding current Founder authority.
7. The `issuer` field is not authority; authority is proved by the authenticated
   issuance context and a durable principal record.
8. Only `outcome = APPROVED` may be redeemed.
9. `DENIED` and `CANCELLED` never consume a use, never create a journal `INTENT` and
   never authorise an effect.
10. The authenticated redeemer must equal the recipient.
11. Authorization issuance, its decision row and its wait identity must be consistent and
    land atomically.

→ **INV-A2, INV-A3, INV-A6, INV-L3, INV-X4**

## FE-2 — Required use limit and provenance groups

1. `use_limit` is never inferred by default in any of the six action kinds.
2. `merge`, `production_write`, `destructive_operation`, `policy_weakening` and
   `waive_finding` fix `use_limit = 1`.
3. `staging_write` requires an explicit positive integer `use_limit` and must not be
   OPTIONAL.
4. Git provenance for staging and production writes is a structured group: none is
   permitted; any implies `repository_identity`, `base_sha` and `head_sha` together;
   `pr_number` only with `repository_identity`; no isolated head, base or PR number.
5. A `policy_weakening` target uses an immutable policy ID.
6. A policy key path or display name is not authoritative identity.
7. The action matrix and the canonical-identity chapter must agree exactly.

→ **INV-A3, INV-A4, INV-A5, INV-A9**

## FE-3 — Current evidence recomputation

Redemption must not merely verify that the stored snapshot still exists. It must
recompute the current authoritative snapshot from immutable observations against the
current policy's required slots, using an explicit current-selection rule; verify
freshness, provider authority, tuple and conclusion; compare the recomputed digest with
the bound `evidence_snapshot_ref`; and fail closed when any required slot has a newer
failing, expired, unknown or missing observation. Findings and resolution events remain
append-only.

→ **INV-A4, INV-E1, INV-E2, INV-E3, INV-E4, INV-E7**

## FE-4 — UNKNOWN cannot directly execute

`UNKNOWN_PENDING_RECONCILIATION → EXECUTING → external call` is forbidden. UNKNOWN is
first claimed by a fenced reconciler into a distinct `RECONCILING` (or exactly
equivalent probe-only) state in which external writes are forbidden. The reconciler
probes by `redemption_key` first. Confirmed applied ⇒ `CONFIRMED_SUCCEEDED`. Confirmed
not applied **and** same-key retry proven safe ⇒ a new fenced execution attempt may be
created. Still unknown ⇒ back to UNKNOWN, blocked. Nothing is re-sent before a probe.
Reconciliation claims and execution claims are distinguishable and persisted.

→ **INV-X1, INV-X3, INV-L5, INV-L7**

## FE-5 — Manual abandonment is not success

`ABANDONED_BY_DECISION` means only that the Founder stopped automatic reconciliation. It
asserts neither application nor non-application, is never treated as successful
completion, never advances dependent work automatically, and leaves the target
quarantined until a named remediation, compensation or proceed-under-known-risk action
is separately approved. The audit record retains `effect_truth = UNKNOWN`. The Phase 0
completion gate is not satisfied by renaming UNKNOWN to ABANDONED.

→ **INV-X3, INV-S5, INV-A1**

## FE-6 — External capacity is not released by lease expiry alone

Database leases and fencing control orchestrator authority and database writes; they
cannot stop a process that has left the database. For the Global Codex Reviewer:
capacity 1 means at most one actually in-flight invocation within one authority domain,
not merely one `ACTIVE` claim; a lost owner's invocation enters `DRAINING`; a second
invocation is not dispatched until the original is proved terminal, its cancellation is
confirmed, or a probe confirms it is not running; a fencing token may reject a stale
result but does not stop the old process; a provider without terminal probe or
cancellation keeps occupying capacity and fails closed; the real adapter does not exist
before Phase 1A and Phase 0 proves the lifecycle contract against a fake provider; claim
invariants and any future provider-invocation invariant are expressed separately; and
the current `/tmp` lock is a transitional operational mechanism that does not satisfy a
durable global invariant.

→ **INV-P1, INV-P2, INV-X2, INV-L5, INV-L7**

## FE-7 — Fencing honesty

The specification must not claim that a stale holder cannot act externally. It claims
only that a stale token cannot update authoritative state, that stale results are
rejected, that preventing a duplicated external effect additionally requires provider
idempotency, a probe or cancellation, and that a provider with none of these may not be
registered.

→ **INV-L7, INV-X2**

## FE-8 — Phase boundaries

Two gates. The **Phase 0 completion gate** evaluates only PR-0 and PR-A–PR-I; real
integrations stay closed; a completed Phase 1A specification is not required; D14 does
not block the "Phase 0 completed" state. The **Phase 1A entry gate** requires Phase 0
complete, D13 decided, D14 decided, the provider lifecycle specification approved in
writing, and a separate Founder authorisation. Before that, no real adapter
implementation may begin.

→ **INV-R1, INV-A1**

## FE-9 — Plan PDF status

The Plan v2.2 PDF is **not** the canonical specification. Its measured properties are:

| | |
|---|---|
| actual PDF pages | 16 |
| content pages | 13 |
| blank trailing pages | 3 |
| SHA-256 | `d60c2b6873d8ea8fae6e4f8359939abdc6c89556ed33316ccb63649ee0a7df93` |

The earlier report of "14 pages, 0 blank" must not be cited as verified fact. The files
in this directory are the canonical specification from PR-0 onward, and PR-0 does not
produce a replacement planning PDF.

→ documentation status; carries no invariant text change.
