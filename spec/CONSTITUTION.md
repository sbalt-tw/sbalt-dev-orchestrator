# SBALT Development Orchestrator — Phase 0 Constitution

Governance only. This document says who owns a specification, how large a thing may be
reviewed at once, what is allowed to count as proof, and in what order work may proceed.

It contains no domain design. Task lifecycle, evidence identity, the authorization
envelope, schema, migrations and runtime behaviour are specified by the per-slice
checkpoints described in §2, each carrying its own Founder decision.

Machine-readable mirror: [`manifests/constitution.json`](manifests/constitution.json).
Where prose and the manifest disagree about anything countable, the manifest wins.

---

## 1 · The authority model

Three claims were previously all called "validation". They are different, and none may
borrow authority from another.

| Class | Proves | Mechanism | Can never prove |
|---|---|---|---|
| **A · Structural validation** | The artifact is well-formed and internally complete | Schema, closed enums, required fields, references resolve, no duplicates, every named test indexed | That any statement is true |
| **B · Change detection** | Approved content has or has not changed since a reviewed commit | Git commit identity, base/head comparison, digests bound to a reviewed SHA | That the content was correct when approved |
| **C · Semantic authority** | The content means what it should | Independent whole-diff review at an exact head, plus an explicit Founder decision | — nothing mechanical substitutes for it |

### 1.1 The authority root

Phase 0 does not self-host. Authority therefore rests on four records that live outside
the artifact being judged:

1. **Git immutable commit identity.** A SHA is not editable by the content it names.
2. **The GitHub review and merge record.** Who approved what, at which head, when.
3. **An explicit Founder decision**, recorded with an identifier and an outcome.
4. **An independent reviewer's verdict** on the complete diff at an exact head.

### 1.2 A digest is never its own authority

A digest computed, stored and verified inside the same pull request is **change detection
only**. It proves that content is unchanged; it proves nothing about whether that content
was ever right.

A stored digest is admissible as evidence only when it is bound to at least one record
from §1.1 that lies outside the pull request presenting it. An unbound digest authorises
nothing, including its own content. A pull request may never compute a digest over itself
and cite it as its own authorisation.

Until a baseline is established this way, the recorded baseline is `null`. `null` means
"no reviewed baseline exists yet"; it never means "unchanged".

### 1.3 What a validator may claim

A validator in this repository performs class A and class B work only. It may never be
cited as evidence that a specification is correct, complete in meaning, or wise. A passing
validator means the artifact is well-formed and unchanged since review — nothing more.

Specifically out of scope for any validator here: judging whether a normative sentence is
true; judging whether a mapping is semantically sound; standing in for a reviewer or a
Founder decision; proving that a named test asserts what its name claims.

---

## 2 · Specification topology

### 2.1 Ownership

Specification ownership is split in two:

- **This constitution** holds governance, and only governance.
- **One pre-implementation checkpoint per implementation slice** holds the domain
  specification that slice must satisfy, written with that slice's implementation design
  in hand.

A checkpoint is a docs-only pull request. It does not consume its lane's
implementation-PR slot, and it is not an implementation PR.

### 2.2 Why the specification is not written ahead of the work

Specification written far ahead of implementation has nothing pressing on it. Its only
pressure is adversarial review, which is expensive and has twice proved insufficient: two
prior review rounds returned defects that were not wording errors but *unimplementability*
— rules that could not be carried out as written, which an implementer would have found
immediately. Checkpoints exist so that the reader of a specification is the person about
to build it.

### 2.3 Surface caps

Every pull request in this repository must satisfy all four:

| Cap | Limit | Counting rule |
|---|---|---|
| Changed files | **8** | **Generated files count.** A generated manifest or rendered document counts exactly as a handwritten one does. |
| Handwritten normative content | **700 lines** | Prose and hand-authored manifest content a reviewer must judge for meaning. |
| Total reviewed diff | **1,500 lines** | All added and changed lines. **Lockfiles are the only permitted exclusion.** |
| Load-bearing concepts | **5** | Named models a reviewer must hold at once: a state machine, an identity scheme, a gate, an ordering rule, a transaction boundary. |

**Prohibited evasions.** Generating manifests, fixtures or rendered documents in order to
stay under the handwritten limit. Splitting content across files to duck the per-file cap.
Excluding anything but a lockfile from the total diff.

Exceeding any cap means splitting the pull request along a **concept** boundary. Lines are
never merely redistributed to bring a number down.

### 2.4 Asset disposition rules

Material from a superseded pull request is classified before reuse, and the classification
is a Founder decision:

- **Reuse as-is** — carried forward unchanged. It is still reviewed in the slice that
  reintroduces it; a prior review of a different pull request is not a review of this one.
- **Rewrite** — the obligation survives, the artifact does not.
- **Demote** — the material is not specification and leaves the specification set.
- **Historical evidence only** — retained as a record of what was claimed, and **never
  cited as evidence**.

Effort already spent is not a reason to keep anything.

---

## 3 · Review, closure and budgets

### 3.1 Severity and exact-head review

Finding severity is exactly `BLOCKER`, `HIGH`, `MEDIUM`, `LOW`. A reviewer reporting
`CRITICAL` is recorded as `BLOCKER` with identical treatment.

Every review is of the **complete base-to-head diff at an exact head**, never of an
increment and never of the last commit alone. A reviewer is never scoped by a checklist and
may raise anything, including defects in the material that asked for the review.

A new head is created by any commit touching a tracked file. **A clean or approving verdict
at one head never covers another head.**

### 3.2 Budgets

| Target | Completed verdict rounds |
|---|---|
| This constitution | 2 |
| Checkpoint SPEC-B, SPEC-D, SPEC-F | 2 |
| Checkpoint SPEC-A, SPEC-C, SPEC-E, SPEC-G, SPEC-H, SPEC-I | 1, extendable once under §3.3 |
| Implementation slice | 2 |
| Implementation PR-F | 3 |
| Implementation PR-I | 1, extendable once under §3.3 |

A no-verdict invocation — provider abort, timeout, infrastructure failure — consumes no
completed round, is classified only by a trusted terminal result, and is **never retried
automatically**.

### 3.3 When a single-round target receives findings

For a target whose budget is one completed verdict round, if the first round returns
findings that are repairable within the already-approved specification:

1. One additional completed verdict round is permitted after the repair.
2. The additional round reviews the **exact new head**.
3. **At most two completed verdicts. There is no third round.**
4. A specification gap still stops immediately and returns to the Founder; it is never
   patched inside a round.
5. A no-verdict invocation consumes no completed round and is not retried automatically.
6. A `CLEAN` or `APPROVE` verdict at the old head never carries to the new head.

### 3.4 Stop rules

- **Specification gap** — a finding naming a rule the specification lacks: the target stops
  and returns to the Founder, whatever budget remains. Never patched in-round, never
  decided by a validator.
- **Budget exhausted with a blocker or high outstanding** — hard stop, return to the
  Founder.
- **Surface cap exceeded** — split before review, not after.

### 3.5 Merge conditions

A target may merge only when all hold: zero blocker and zero high, judged as the aggregate
of unresolved findings on the tuple rather than the most recent verdict; every medium and
low carrying a **named Founder disposition** of `FIX`, `ACCEPT` or `DEFER`, with **no
default** — an undispositioned medium blocks merge exactly as a high would; required checks
green at the exact head; and an explicit Founder merge authorisation.

### 3.6 Finding closure evidence

A closure claim is judged by artifacts, not by narrative.

- **Immutable identity.** A finding receives an identifier when raised. It is never edited.
- **Before-fails.** A `FIX` names an artifact — file, test identity, fixture identity —
  that fails at the pre-fix commit, with the command and the observed failure.
- **After-passes.** The same artifact passes at the fix commit, with the command and the
  observed result.
- **Honest controls.** A mutation control must actually remove or invert the load-bearing
  mechanism, and the record must state which mechanism it removed. A control whose name
  claims one bypass while its body exercises another is a failed control, not a passing one.
- **Self-assertion is not evidence.** "I fixed this" carries no weight.
- **`ASSERTED_NOT_PROVEN`.** Where a closure genuinely cannot be reduced to an executable
  artifact, it carries this status and is **counted as open**. A report may contain such
  rows; it may never promote them silently to closed.
- **Semantic gaps go to the Founder** before anything is implemented. A validator never
  decides one.

### 3.7 Security-sensitive evidence

Closure evidence must be auditable without publishing an attack. A closure record may
satisfy §3.6 with any of: a **restricted artifact reference**; an **immutable digest** of
that artifact; a **sanitized reproduction description**; the **exact test or fixture
identity**; and the **auditable before-fails and after-passes results**.

Public specification text, pull request bodies and reviewer briefs carry only safe
characterisations — for example "confirmed execution-boundary defect" or "structural
redesign" — and **never restate a security payload, exploit input or reproduction script**.
The auditability requirement is unchanged: every claim still resolves to something a
reviewer with access can execute.

### 3.8 A round cap is not a correctness proof

Two clean rounds mean two reviewers found nothing. They do not mean nothing is there.

---

## 4 · Gates, capacity and order

### 4.1 Founder authority

These acts require an explicit Founder decision, each time, and are never implied by a
green check or a clean verdict: merging any pull request; closing a pull request as
superseded; enabling any real integration; any staging or production write; any
irreversible act. The absence of a decision is never permission.

### 4.2 Global reviewer capacity

Independent review capacity is **1 within one authority domain** — one authoritative
database and the host that owns it — measured as at most one *actually in-flight*
invocation, not merely one active claim record.

A lost or expired claim does not by itself release external capacity: an invocation whose
owner is lost continues to occupy capacity until it is proved terminal, its cancellation is
confirmed, or a probe confirms it is not running. A provider supporting neither a terminal
probe nor cancellation holds capacity indefinitely and fails closed.

The reviewer is a principal distinct from the principal that produced the change.

### 4.3 Phase gates

Two gates. They are separate, satisfying one never satisfies the other, and **both are
non-waivable**.

**Phase 0 completion gate** — evaluates only whether the constitution, every checkpoint and
every implementation slice are complete. Real integrations are not required and stay
closed. Its conditions are recorded in the manifest and expanded by each slice as that
slice lands.

**Phase 1A entry gate** — evaluates whether real provider implementation may begin. It
requires the Phase 0 gate satisfied, its own deferred decisions answered with an approved
**resolution** carrying an outcome, a content reference and a content version — the
existence of a decision row satisfies nothing — and a separate Founder authorisation.

Until every condition holds, no real adapter implementation may begin.

### 4.4 Non-waivable rules

The following may be changed only by a new specification pull request carrying a Founder
decision, never by a runtime policy change: the rule that absence is never consent; both
phase gates; the Founder staging, production and destructive-operation gates; reviewer
independence; global reviewer capacity 1; the exact-head review requirement; and one
implementation pull request per lane.

Anything not explicitly marked waivable is non-waivable.

### 4.5 Order

Per domain, strictly sequential:

1. The checkpoint pull request opens.
2. Exact-head review, within its budget.
3. Founder disposition of every finding, then Founder merge authorisation.
4. The checkpoint pull request is merged and closed.
5. **Only then** may the implementation pull request for that domain open.

A checkpoint and its implementation pull request may **never** be open at the same time, so
a specification cannot keep moving while its implementation is being written. Because the
slice order is a strict total order, at most one checkpoint **or** one implementation pull
request is open across the project at any moment.

The number of checkpoint pull requests on the normal path is one per implementation slice.
That count is a plan, not an invariant: a superseded checkpoint increases the historical
count.

### 4.6 Disposition of the superseded pull requests

Two pull requests predate this constitution and are superseded by it. Both remain **open
and unmerged** until this constitution merges. They are then closed as superseded, with
their branches and complete review history retained, under a **separate explicit Founder
authorisation given at that time**. Approving the order recorded here does not authorise
closing, editing or merging either of them.

---

## 5 · Decision ledger

Recorded in [`manifests/constitution.json`](manifests/constitution.json), which is the
authoritative list. Approved: the topology, the authority model, the closure contract, the
order and disposition, the surface caps and budgets, the asset-disposition rules, and the
single-round extension rule of §3.3.

Deferred, and **not decided by this constitution**: the task lifecycle model; the task
creation transaction; the terminal fail-closed rule; evidence slot derivation; the
generation and ordering model; and the staging use-limit ceiling. Each is answered by the
checkpoint that owns it. Three further decisions remain deferred beyond Phase 0 sequencing
and block nothing here.

**No provider identifier is assumed to be monotonically ordered.** Any ordering model must
cite an explicit published contract, and that choice belongs to the checkpoint that needs
it — not to this document.
