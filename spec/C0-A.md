# C0-A · Authority, baseline, review identity, CI evidence, reviewer capacity

This is the canonical normative source for five things and nothing else. It is
human-readable Markdown; there is no machine-readable mirror of it, and no requirement
stated here is stated only elsewhere.

**Status.** The authority for this text lives outside this repository — a Founder decision
and an independent review of an exact head. This file does not record that authority and
must not be read as evidence of it. Nothing here is self-approving.

**Scope.** Finding closure, review budgets, merge conditions, surface-cap rules, the stage
registry, phase completion gates, checkpoint topology, asset disposition, task lifecycle,
the evidence domain model, the authorization envelope, runtime, database, migrations and
Phase 1A are **out of scope**. They belong to later slices and are not decided here.

---

## 1 · Authority and proof classes

### 1.1 Who decides what

**Founder** — the human authority for product direction, architecture, high-risk merges,
waiving a finding, and any staging or production write.

**GPT Coordinator** — provides reasoning and coordination. It is not a final authority and
cannot approve anything.

**Workers** — disposable execution. They hold no authority and no durable state.

**Codex** — an independent, read-only reviewer. It does not modify code.

**Repository validator** — mechanical checks only, of the two kinds below.

### 1.2 Three kinds of proof

**Structural validation** shows an artifact is well-formed: shape, paths, required fields,
formatting. **Change detection** shows whether content differs from a named commit, by
comparing Git identities. **Semantic authority** — that the content means what it should —
is neither of these, and no program in this repository produces it.

Semantic authority comes from two records outside the artifact being judged: an auditable
Founder decision, and an independent review of an exact head. A validator may never be
cited as evidence that a specification is correct.

### 1.3 What this repository does not yet do

Phase 0 does not self-host. The orchestrator described by these slices does not exist and
is not enforcing anything. Every rule here is currently carried out by people and by
external coordination, and any statement that the repository already enforces its own
rules would be false.

---

## 2 · The external baseline lifecycle

A baseline records which reviewed state is authoritative. It is a procedure, not a feature:
nothing in this repository implements it, and this slice adds no database, no manifest
state and no automatic storage.

| State | Meaning |
|---|---|
| `NOT_ESTABLISHED` | No authoritative baseline exists; nothing is unchanged since review. |
| `ESTABLISHED` | A baseline exists in the external coordination record. |
| `SUPERSEDED` | A later amendment replaced it. The superseded record is retained, never deleted. |

Rules:

1. A candidate pull request is `NOT_ESTABLISHED` until it merges. It cannot be anything
   else while it is open.
2. A pull request may never turn its own fields, or a digest it computes over itself, into
   semantic approval.
3. An `ESTABLISHED` baseline is created only after **both**: the Founder approves the exact
   reviewed tuple of §3, and GitHub records the merge. It is created in the external
   coordination record, not here.
4. A constitutional amendment creates a new tuple. The previous baseline becomes
   `SUPERSEDED`; its history is kept.
5. The GitHub record is audit evidence. It does not, by itself, replace Founder authority.

---

## 3 · The exact review tuple

A verdict is bound to a tuple, never to a head alone. The tuple is:

1. repository identity
2. pull request number
3. base SHA
4. merge-base SHA
5. head SHA
6. head tree SHA
7. diff identity, together with the algorithm and version that produced it
8. CI evidence identity
9. reviewer identity
10. verdict identity

**If any field changes, the previous verdict is invalid.** In particular:

* If the base branch moves, the tuple is invalid **even though the head has not changed**,
  because the diff has changed.
* A green required check recorded against an older tuple does not carry to a new one.
* Before merge, base, head and merge-base are **re-read from Git**. The GitHub interface is
  not the source of truth for them.
* After a squash merge, the merged tree must be verified to equal the reviewed head tree.
  If it does not, the merge did not deliver what was reviewed.

This section defines a procedure. There is no authority service in this repository that
performs it, and none is claimed.

---

## 4 · Exact-head CI evidence

A `pull_request` workflow run must be able to prove which commit it actually executed. The
default checkout for that event is a synthetic merge commit, which is not the reviewed
head, so the workflow checks out the head explicitly and then proves it did.

The workflow:

* checks out `github.event.pull_request.head.sha` explicitly;
* asserts that `git rev-parse HEAD` equals the event head SHA, and fails if it does not;
* fetches the declared base;
* computes and records the merge-base;
* computes and records the head tree SHA;
* computes the diff identity with a fixed, versioned algorithm;
* prints all of those values into the run log;
* runs with minimal read-only permissions and uses no secrets;
* relies on no provider identifier being monotonically ordered.

### 4.1 Diff identity, version 1

```
diff-identity/v1 =
  git diff --no-color --no-ext-diff --no-renames --binary <base>..<head> \
    | git hash-object --stdin
```

Rename detection is disabled so the value depends only on the two trees and this command.
A future change to this command is a new version, never a silent redefinition of v1.

### 4.2 What the workflow cannot do

GitHub does not guarantee that a pull request workflow re-runs when the base branch moves
on its own; the default activity types respond to head changes. A green check may therefore
survive a base movement that invalidated the tuple.

Consequently the external coordinator re-verifies the tuple **before review and again
before merge**. The workflow produces evidence; it never authorises a merge.

---

## 5 · Global reviewer capacity

Phase 0 bootstrap procedure only. No database lease and no fencing token is implemented in
this slice.

**Capacity is 1.** At most one reviewer invocation is in flight at a time within the
authority domain, which is the set of projects, agents and sessions currently sharing this
coordination process.

The current mechanism is a lock file under `/tmp`. It guarantees single-host bootstrap
serialisation and nothing more; it is not safe across hosts and is not claimed to be.

Procedure:

* **Acquire atomically.** Create the lock with an operation that fails if it already
  exists, rather than checking and then writing.
* **Record ownership:** the owning session, the task, the exact base and head, the purpose,
  and the time taken.
* **Judge liveness** by whether the invocation's process is still running, not by elapsed
  time alone.
* **Only the owner releases it,** and only after its process is terminal.
* **Never** take, delete or take over a lock a live holder still owns, and never poll it in
  a long loop.
* An invocation that returns **no verdict** consumes no completed round.
* A failed or abandoned invocation is **never retried automatically**.
* A lost invocation returns to the Founder and the Coordinator for a decision.

Before a second host or a second authority domain exists, this procedure must be decided
again. It does not extend to either.
