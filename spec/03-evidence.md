# 03 · Evidence

Canonical data: [`manifests/evidence-model.json`](manifests/evidence-model.json).
Authority: **FE-3** and **D17**.

Hashing mutable row identifiers proves only that the same rows were named, not that
they still say the same thing. Evidence is therefore modelled as immutable content.

## Observations

1. **Observations are immutable and append-only.** CI results, review verdicts and
   findings are written once.
2. **Content is fixed at write**, and the whole of it is covered by the content digest:

   | Field | Why it is in the content |
   |---|---|
   | `evidence_slot_identity` | So the slot cannot live only in mutable row metadata. |
   | `evidence_kind` | A CI result and a review verdict are not interchangeable. |
   | `provider_immutable_identity` | Never a display name. |
   | `project_identity`, `task_identity` | The work this attests to. |
   | `tuple` | The exact `(repository, base, head)`, where the slot is tuple-bound. |
   | `logical_check_key` | A renamed display label cannot silently become a different check. |
   | `provider_source_event_identity` | The provider's own identity for the event. |
   | `source_generation` | The provider's trusted monotonic generation or revision. |
   | `status`, `conclusion` | What it says. |
   | `source_principal` | Who delivered it. |
   | `observed_at` | Audit only. Never used to order truth. |

3. **A state change is a new observation.** No observation is ever rewritten in place.
4. `content_digest` = sha256 over the versioned canonical serialization of that content.
   `evidence_snapshot_ref` = sha256 over the sorted, newline-joined content digests.
5. **Findings resolve by append-only resolution events** — a superseding tuple, or a
   `waive_finding` authorization. The finding row is never rewritten, so the audit trail
   of what was found survives its resolution.
6. **Gating reads the aggregate.** Merge stays blocked while any finding on the tuple
   carries no terminal resolution event. A later clean verdict resolves nothing.

## Which observation is current

Round 1 found that "the most recent observation" had no total order and no tie rule: a
`PASS` and a `FAIL` written at the same instant could resolve either way, and storage order
could decide it. D17 fixes the ordering:

* The current observation for a slot is the one carrying the **greatest trusted
  `source_generation`** — the monotonic generation or revision the provider attaches to its
  own results.
* `observed_at` and **database ingestion order never order provider truth, and never break
  a tie.** Neither does a row id or an insertion sequence.
* Same slot, same generation, **same digest** ⇒ `IDEMPOTENT_DUPLICATE`; the redelivery
  changes nothing.
* Same slot, same generation, **different digest** ⇒ `CONFLICTED`; the **whole slot fails
  closed** and nothing in it may be used as gate evidence until the provider supplies a
  greater generation.
* **No single greatest generation** ⇒ `CONFLICTED`, for the same reason.
* A provider that offers **no trusted monotonic ordering contract** over its own results
  may not supply gate evidence at all.

## The snapshot is recomputed, not merely re-checked

At redemption it is not sufficient to confirm that the snapshot the envelope names
still exists (FE-3). The runtime must:

1. Read the **current policy's required evidence slots** for this action kind.
2. Select the authoritative observation for each slot by the ordering rule above. An
   older observation is never preferred because it happens to be a pass.
3. Verify freshness against the slot's stated maximum age, the source's authority for
   that slot, the tuple, and the conclusion.
4. Compute the **current snapshot digest** from those observations' content digests.
5. Compare it with the `evidence_snapshot_ref` bound in the envelope.
6. **Fail closed** if any required slot has a newer failing, expired, unknown, conflicted
   or missing observation, or if the digests differ.

Redemption therefore verifies three things, not one: that the recomputed snapshot equals
the bound reference, that those observations satisfy the evidence policy *currently* in
force, and that the tuple they are bound to still equals the effect tuple.

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
