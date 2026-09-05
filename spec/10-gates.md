# 10 · The two gates

Canonical data: [`manifests/gates.json`](manifests/gates.json).

These are **two separate gates**. Satisfying one never satisfies the other (INV-R1), and
neither is a stage of the other.

## Phase 0 completion gate

Evaluates only whether PR-0 and PR-A through PR-I are complete. Real integrations are
not required and stay closed. A completed Phase 1A specification is **not** required, and
neither D13 nor D14 blocks this gate (FE-8).

Phase 0 is complete when all of the following hold simultaneously:

* **G0-1** PR-0 and PR-A through PR-I are merged to `origin/main` in that order.
* **G0-2** All 47 invariants have at least one passing conformance test and at least one
  *negative* test each.
* **G0-3** The specification validator passes: no ID lacks a family, four owners or a
  named test; the census equals the manifest length.
* **G0-4** Every Round 1–5 finding and every carried debt item is closed against its
  invariant, or explicitly deferred by a recorded decision.
* **G0-5** Every medium and low raised in any slice carries a recorded FIX, ACCEPT or
  DEFER. None is undispositioned.
* **G0-6** The migration chain upgrades a populated `v1` database through `v2`–`v7` with
  all rows, references and provenance preserved, verified at each step.
* **G0-7** No slice carries an open blocker or high, judged as the tuple aggregate of R4.
* **G0-8** No effect-journal entry is in a non-terminal state, and no entry closed by
  decision is counted as a success.
* **G0-9** The documentation-conformance check passes: no documented guarantee lacks a
  test, no documented command fails when run as written.
* **G0-10** Auto-merge, self-hosting and every real integration remain disabled, verified
  by test.
* **G0-11** The deployment note records the D3 single-domain constraint.

## Phase 1A entry gate

Evaluates whether real provider implementation may begin.

* **G1-1** The Phase 0 completion gate is satisfied.
* **G1-2** D13 is decided.
* **G1-3** D14 is decided.
* **G1-4** The provider lifecycle specification is approved in writing, in whichever
  slice D14 selects.
* **G1-5** The Founder separately authorises Phase 1A.

Until every condition holds, **no real adapter implementation may begin**. The absence of
a decision is not permission (INV-A1).
