# SBALT Development Orchestrator — Phase 0 Constitution

Governance only. This document says who owns a specification, how large a thing may be
reviewed at once, what is allowed to count as proof, and in what order work may proceed.

It contains no domain design. Task lifecycle, evidence identity, the authorization
envelope, schema, migrations and runtime behaviour are specified by the per-stage
checkpoints in §5, each carrying its own Founder decision.

Machine-readable mirror: [`manifests/constitution.json`](manifests/constitution.json).
Where prose and the manifest disagree about anything countable, the manifest wins. The
manifest introduces no requirement that is not stated here.

---

## 1 · The authority model

Three claims were previously all called "validation". They are different, and none may
borrow authority from another.

| Class | Proves | Mechanism | Can never prove |
|---|---|---|---|
| **A · Structural validation** | The artifact is well-formed and internally complete | A closed schema, exact enums, required non-empty fields, resolved references, uniqueness | That any statement is true |
| **B · Change detection** | Approved content has or has not changed since a reviewed commit | Git commit and tree identity compared against an externally bound baseline | That the content was correct when approved |
| **C · Semantic authority** | The content means what it should | Independent whole-diff review at an exact head, plus an explicit Founder decision | — nothing mechanical substitutes for it |

### 1.1 The authority root

Phase 0 does not self-host. Authority rests on four records outside the artifact judged:

1. **Git immutable commit and tree identity.** A SHA is not editable by what it names.
2. **The GitHub review and merge record.** Who approved what, at which head, when.
3. **An explicit Founder decision**, recorded with an identifier and an outcome.
4. **An independent reviewer's verdict** on the complete diff at an exact head.

### 1.2 A digest is never its own authority

A digest computed, stored and verified inside the same pull request is **change detection
only**. A pull request may never establish, store and verify its own semantic authority.

### 1.3 The reviewed baseline

The baseline has an explicit state. It is never `null` and never an empty string, because
neither can be distinguished from an omission.

- `NOT_ESTABLISHED` — no authoritative baseline exists. Nothing may be described as
  unchanged since review. This is the state until this pull request merges.
- `ESTABLISHED` — every component of the baseline tuple below is present and non-empty.

The baseline tuple binds: repository identity · pull request number · review base SHA ·
merge-base SHA · reviewed head SHA · reviewed head tree SHA · diff identity · reviewer
verdict identity · Founder decision reference · merge commit SHA · merged tree SHA.

An authoritative baseline is established **only at merge**, from records outside this pull
request. This pull request does not establish one and must not appear to.

### 1.4 What a validator may claim

A validator here performs class A and class B work only. **A passing validator means the
artifact is well-formed and, where a baseline is established, unchanged against it. It
never means the specification is correct, and while the baseline is `NOT_ESTABLISHED` it
says nothing about change at all.**

Out of scope for any validator here: judging whether a normative sentence is true; judging
whether a mapping is semantically sound; counting load-bearing concepts; standing in for a
reviewer or a Founder decision; proving that a named test asserts what its name claims.

---

## 2 · Specification topology

### 2.1 Ownership

- **This constitution** holds governance, and only governance.
- **One pre-implementation checkpoint per implementation stage** holds the domain
  specification that stage must satisfy, written with its implementation design in hand.

A checkpoint is a docs-only pull request. It does not consume its lane's
implementation slot, and it is not an implementation pull request.

### 2.2 Why the specification is not written ahead of the work

Specification written far ahead of implementation has nothing pressing on it. Its only
pressure is adversarial review, which is expensive and has twice proved insufficient: two
prior reviews returned defects that were not wording errors but *unimplementability* —
rules that could not be carried out as written. Checkpoints exist so that the reader of a
specification is the person about to build it.

### 2.3 Surface caps

Every pull request must satisfy all four. Counting is mechanical and single-valued; the
exact rules are in the manifest under `surface_caps.counting`.

| Cap | Limit |
|---|---|
| Changed files | **8** |
| Handwritten normative lines | **700** |
| Total reviewed diff lines | **1,500** |
| Load-bearing concepts | **5** |

**Counting rules.** Base and head are taken from the exact review tuple of §3.1, never
from a moving ref. A changed file is any changed path, **including generated files and the
lockfile**; a rename or copy counts **both** its source and destination path. *Handwritten
normative lines* are additions plus deletions on the paths enumerated in
`normative_markdown_paths`. *Total reviewed diff lines* are additions plus deletions across
every text file, and **only lockfile lines may be excluded**. A changed **binary** file
cannot be line-counted and therefore **fails closed**; it is never counted as zero.

**Prohibited evasions.** Placing a normative requirement in a file outside
`normative_markdown_paths` — no such file may carry a requirement absent from a normative
Markdown path. Generating content to stay under the handwritten limit. Bundling rules that
can change independently into one declared concept. Omitting a model from the declared
concept list. There is no per-file line cap and none may be inferred.

Exceeding any cap means splitting along a **concept** boundary. Lines are never merely
redistributed, and a cap is never widened to fit the work.

### 2.4 Load-bearing concepts

A concept is a model a reviewer must hold whole. **The count is a semantic assessment made
by the reviewer and the Founder; no validator may claim to prove it.** The validator checks
only that the declared list equals the approved list, which is a class A check on a
declaration.

### 2.5 Asset disposition rules

Material from a superseded pull request is classified before reuse, and the classification
is a Founder decision: **reuse as-is** — carried forward unchanged, and still reviewed in
the stage that reintroduces it, because a prior review of a different pull request is not a
review of this one; **rewrite** — the obligation survives, the artifact does not;
**demote** — it is not specification and leaves the specification set; **historical
evidence only** — retained as a record of what was claimed, and never cited as evidence.

Effort already spent is not a reason to keep anything.

---

## 3 · Review, closure and budgets

### 3.1 The exact review tuple

A verdict is bound to a tuple, not to a head. The tuple binds: repository · pull request ·
base SHA · merge-base SHA · head SHA · head tree SHA · diff identity · CI evidence
identity · reviewer verdict identity.

**If any component changes, the verdict is invalid.** A base that moves changes the diff
without changing the head, and a verdict bound only to a head would survive that. It does
not survive here.

Severity is exactly `BLOCKER`, `HIGH`, `MEDIUM`, `LOW`; a reviewer reporting `CRITICAL` is
recorded as `BLOCKER`. Review is of the complete base-to-head diff, never of an increment
or of the last commit alone, and a reviewer is never scoped by a checklist.

### 3.2 Exact-head CI

Continuous integration must test the reviewed head itself. A `pull_request` workflow
checks out `github.event.pull_request.head.sha` explicitly, then **asserts** that
`git rev-parse HEAD` equals it; fetches the declared base and asserts the merge-base equals
the reviewed base; and records the head tree and diff identity as evidence. The default
synthetic merge checkout is not exact-head CI and is never described as such.

CI runs with minimal read-only permissions and no secrets, and never relies on any provider
identifier being monotonically ordered.

### 3.3 Budgets

Every stage has exactly one budget row in the manifest. **There is no generic row and no
precedence rule to get wrong.** A conditional extension never produces a third completed
verdict.

| Stage | Completed verdict rounds |
|---|---|
| PR-C0 | 2 |
| SPEC-A, C, E, G, H, I | 1, plus one conditional round, maximum 2 |
| SPEC-B, D, F | 2 |
| PR-A, B, C, D, E, G, H | 2 |
| PR-F | 3 |
| PR-I | 1, plus one conditional round, maximum 2 |

The conditional round is permitted only where the first round's findings are repairable
within the already-approved specification. It reviews the exact new tuple. **A `CLEAN` or
`APPROVE` verdict at an old tuple never carries to a new one.** A no-verdict invocation —
provider abort, timeout, infrastructure failure — consumes no completed round, is
classified only by a trusted terminal result, and is **never retried automatically**.

### 3.4 Stop rules

- **Specification gap** — a finding naming a rule the specification lacks: stop and return
  to the Founder, whatever budget remains. Never patched in-round, never decided by a
  validator.
- **Budget exhausted with a blocker or high outstanding** — hard stop.
- **Surface cap exceeded** — split before review.

### 3.5 Merge conditions

Zero blocker and zero high, judged as the aggregate of unresolved findings on the tuple
rather than the most recent verdict; every medium and low carrying a **named Founder
disposition** of `FIX`, `ACCEPT` or `DEFER`, with **no default**; required checks green at
the reviewed head; and an explicit Founder merge authorisation.

### 3.6 Findings are immutable

A finding is frozen when raised: its identifier, its full original text, its severity, the
tuple it was raised against, and a digest of that content. **Closure never rewrites a
finding.** A closure record is appended, references the original digest and tuple, and
leaves the original readable.

### 3.7 Closure by proof class

A finding is closed by the route its proof class allows. Requiring executable evidence for
a claim no honest oracle can decide would make semantic findings permanently unclosable;
that is a defect, not rigour.

**Structural or executable finding.** A `FIX` provides an artifact that fails before the
fix and passes after it, each with its exact command and result, and — where a load-bearing
mechanism exists — a mutation control that genuinely removes or inverts it and states which
mechanism it removed.

**Change-detection finding.** Closed by exact Git identity: base, head, merge-base, tree
and diff digests, checked against the external review tuple. Never self-approved by the
pull request presenting it.

**Semantic or specification finding.** No executable oracle is invented. Closure requires
all four: the corrected exact new head; the same immutable finding identifier and content
digest; an independent reviewer verdict at that exact head explicitly confirming the
finding is resolved; and a Founder decision or disposition bound to that tuple.

`ASSERTED_NOT_PROVEN` marks a closure missing the evidence **its own class** requires, and
such a finding stays open. A purely semantic finding is never left permanently open merely
because no program can test it.

### 3.8 Security-sensitive evidence

Closure evidence must be auditable without publishing an attack. A record may satisfy §3.7
with a **restricted artifact reference**, an **immutable digest** of it, a **sanitized
reproduction description**, the **exact test or fixture identity**, and the auditable
before-and-after results. Public specification text, pull request bodies and reviewer
briefs carry only safe characterisations and **never restate a payload, exploit input or
reproduction script**.

### 3.9 A round cap is not a correctness proof

Two clean rounds mean two reviewers found nothing. They do not mean nothing is there.

---

## 4 · Gates, capacity and authority

### 4.1 Founder authority

These acts require an explicit Founder decision, each time, and are never implied by a
green check or a clean verdict: merging any pull request; closing one as superseded;
enabling any real integration; any staging or production write; any irreversible act. The
absence of a decision is never permission.

### 4.2 Global reviewer capacity

Independent review capacity is **1 within one authority domain** — one authoritative
database and the host that owns it — measured as at most one *actually in-flight*
invocation, not one active claim record. A lost or expired claim does not release external
capacity: an invocation whose owner is lost keeps occupying capacity until it is proved
terminal, its cancellation is confirmed, or a probe confirms it is not running. A provider
supporting neither a terminal probe nor cancellation holds capacity indefinitely and fails
closed. The reviewer is a principal distinct from the one that produced the change.

### 4.3 Phase gates

Two gates, separate, and **both non-waivable**. Satisfying one never satisfies the other.

**Phase 0 completion** — false until every one of the nineteen stages in §5 is complete in
order. Absence of a stage record is failure, never silence.

**Phase 1A entry** — requires Phase 0 complete; each deferred decision answered by an
approved **resolution** carrying an outcome, a content reference and a content version, the
existence of a decision row satisfying nothing; and a separate Founder authorisation.

### 4.4 Non-waivable rules

Changed only by a new specification pull request carrying a Founder decision, never at
runtime: absence is never consent; both phase gates; the Founder staging, production and
destructive-operation gates; reviewer independence; global reviewer capacity 1; the exact
review tuple requirement; and one implementation pull request per lane. Anything not
explicitly marked waivable is non-waivable.

---

## 5 · The stage registry

Phase 0 is exactly **nineteen stages** in this total order, and the registry is closed:

`PR-C0` · `SPEC-A` · `PR-A` · `SPEC-B` · `PR-B` · `SPEC-C` · `PR-C` · `SPEC-D` · `PR-D` ·
`SPEC-E` · `PR-E` · `SPEC-F` · `PR-F` · `SPEC-G` · `PR-G` · `SPEC-H` · `PR-H` · `SPEC-I` ·
`PR-I`

- The next stage is derived **only** from this order. A pull request never declares itself
  next.
- A missing, duplicated, unknown, misordered or renumbered stage **fails closed**.
- Phase 0 completion is false until all nineteen are complete, in order. Completion is
  never inferred from the rows that happen to exist.
- Adding, removing or reordering a stage is a constitutional amendment requiring a new
  semantic review and a Founder decision.

Per stage, strictly sequential: the checkpoint opens; it is reviewed at its exact tuple
within budget; the Founder dispositions every finding and authorises the merge; the
checkpoint merges and closes; **only then** may that stage's implementation pull request
open. A checkpoint and its implementation are never open at the same time, so a
specification cannot move while its implementation is being written. Because the registry
is a total order, at most one stage is open at any moment.

### 5.1 The superseded pull requests

Two pull requests predate this constitution. Both remain **open and unmerged** until it
merges, and are then closed as superseded with branches and full review history retained,
under a **separate explicit Founder authorisation given at that time**. Approving the order
recorded here does not authorise closing, editing or merging either of them.

---

## 6 · Decision ledger

The manifest holds the authoritative list. Approved here: the topology, the authority and
baseline model, the exact review tuple and exact-head CI, the closure contract by proof
class, the stage registry, the order and disposition, the surface caps and counting rules,
and the budgets.

Deferred, and **not decided by this constitution**: the task lifecycle model; the creation
transaction; the terminal rule; evidence slot derivation; the generation and ordering
model; and the staging ceiling. Each is answered by the checkpoint that owns it. Three
further decisions remain deferred beyond Phase 0 sequencing and block nothing here.

**No provider identifier is assumed to be monotonically ordered.** Any ordering model must
cite an explicit published contract, and that choice belongs to the checkpoint that needs
it — not to this document.
