# 10 · The two gates

Canonical data: [`manifests/gates.json`](manifests/gates.json). Both gate identities, all
sixteen condition identities, the G0-8 rejection set and the decision requirements of the
Phase 1A conditions are anchored in `tools/spec/anchors.ts`.

These are **two separate gates**. Satisfying one never satisfies the other (INV-R1), and
neither is a stage of the other. **Both are non-waivable** (D18): no `policy_weakening`
envelope can touch either, and changing one requires a specification PR carrying a Founder
decision.

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
* **G0-8** **Every effect-journal entry has a definite truth.** No entry is in a
  non-terminal state, and no entry is `ABANDONED_BY_DECISION`, quarantined, or carrying
  `effect_truth = UNKNOWN`. An abandoned entry satisfies this condition only after its
  named remediation has produced a definite outcome.
* **G0-9** The documentation-conformance check passes: no documented guarantee lacks a
  test, no documented command fails when run as written.
* **G0-10** Auto-merge, self-hosting and every real integration remain disabled, verified
  by test.
* **G0-11** The deployment note records the D3 single-domain constraint.

G0-8 previously read "no entry is in a non-terminal state, and no entry closed by decision
is counted as a success". `ABANDONED_BY_DECISION` is terminal for automation and was not
being counted as a success, so it satisfied both halves — the exact opposite of what FE-5
requires. The condition now names what it rejects, and the anchor holds that rejection set.

## Phase 1A entry gate

Evaluates whether real provider implementation may begin.

* **G1-1** The Phase 0 completion gate is satisfied.
* **G1-2** **D13** carries a resolution with outcome `APPROVED`, a content reference and a
  content version, **and the consequence of that outcome holds**: if D13 says medium and
  low debt blocks Phase 1A, then no such debt remains open.
* **G1-3** **D14** carries a resolution with outcome `APPROVED` naming the exact
  specification slice that holds the provider lifecycle, and its content version.
* **G1-4** The provider lifecycle specification is approved in writing at exactly the
  location and version D14's resolution names.
* **G1-5** The Founder separately authorises Phase 1A.

Until every condition holds, **no real adapter implementation may begin**. The existence of
a decision row is not a decision: a condition naming a decision is satisfied only by an
approved resolution with a content reference and a content version, whose consequence has
been evaluated. The absence of a decision is not permission (INV-A1).
