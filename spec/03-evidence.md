# 03 · Evidence

Hashing mutable row identifiers proves only that the same rows were named, not that
they still say the same thing. Evidence is therefore modelled as immutable content.

## Observations

1. **Observations are immutable and append-only.** CI results, review verdicts and
   findings are written once.
2. **Content is fixed at write:** status, conclusion, source principal, provider
   identity, the `(repository, base, head)` tuple, `observed_at`, and any result the
   policy reads.
3. **A state change is a new observation.** No observation is ever rewritten in place.
4. `content_digest` = sha256 over the versioned canonical serialization of that content.
   `evidence_snapshot_ref` = sha256 over the sorted, newline-joined content digests.
5. **Findings resolve by append-only resolution events** — a superseding tuple, or a
   `waive_finding` authorization. The finding row is never rewritten, so the audit trail
   of what was found survives its resolution.
6. **Gating reads the aggregate.** Merge stays blocked while any finding on the tuple
   carries no terminal resolution event. A later clean verdict resolves nothing.

## The snapshot is recomputed, not merely re-checked

At redemption it is not sufficient to confirm that the snapshot the envelope names
still exists (FE-3). The runtime must:

1. Read the **current policy's required evidence slots** for this action kind.
2. For each slot, select the authoritative observation by an **explicit current-selection
   rule**: the most recent observation for that slot on the exact current tuple from a
   source the policy authorises. An older observation is never preferred because it
   happens to be a pass.
3. Verify freshness against the slot's stated maximum age, the source's authority for
   that slot, the tuple, and the conclusion.
4. Compute the **current snapshot digest** from those observations' content digests.
5. Compare it with the `evidence_snapshot_ref` bound in the envelope.
6. **Fail closed** if any required slot has a newer failing, expired, unknown or missing
   observation, or if the digests differ.

This is what makes INV-A4 meaningful: invalidation is evaluated against bound *content*.
A provider that flips a check from pass to fail produces a new observation, a different
current snapshot digest, and an invalid authorization — even though every identifier is
stable.

## Tuple binding

Every observation is bound to an exact `(repository, base, head)` tuple and is
meaningless outside it. Comparison is on all three components. Comparing head alone
lets a change of base preserve an obsolete review, which is exactly the round-5 defect
recorded as `R5-F2` in [`manifests/findings.json`](manifests/findings.json).

## CI is a slot like any other

No task becomes a merge candidate or reaches a terminal success state without CI
recorded as passed for the exact current tuple, judged from the recomputed current
snapshot. An authorization granted while CI is pending does not become valid when CI
later passes: the snapshot it bound is not the snapshot that now exists.
