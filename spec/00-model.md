# 00 · Model, threats and vocabulary

## What the orchestrator is

A durable coordinator for multi-agent software development work. It persists **Tasks**
and **Lanes**; workers are disposable compute that hold nothing. It advances work
through an explicit state machine, gates every consequential action behind a Founder
authorization, and journals every effect that leaves the database.

It is not a build system, a CI runner or an agent. It decides *what may happen next*
and records *what actually happened*.

## What Phase 0 is

Phase 0 builds the machinery and proves it against fake providers. Every real
integration — Claude, GPT, Codex, GitHub, staging, production — is closed. Auto-merge
is off. Self-hosting is off and unparseable. A Phase-0 database can describe a
production write and can never perform one.

## The failure this specification exists to prevent

Five review rounds against PR #1 found the same defect in nineteen different places,
and it always had the same shape:

> **Absence was read as consent.**

A missing outcome became an approval. A missing CI result became a passing one. A
missing base comparison made an obsolete review current. An expired lease stayed
authority. A legacy row that recorded nothing became a grant. A provider that answered
nothing became a definite failure.

Every invariant in this specification is a place where that reading is made impossible,
and every negative test asks the same question: *what value, state or silence would let
this pass when it should not?*

## Threat model

The orchestrator does not model a malicious external attacker. It models the failures
that actually occur in an automated development pipeline:

| Threat | Shape |
|---|---|
| **Confused deputy** | A worker, a coordinator or a report persuades the orchestrator to perform an action nobody authorised, by asserting authority in its own message. |
| **Stale authority** | An authorization, a review verdict, a lease or a policy read is still held after the world it described has changed. |
| **Silent widening** | A configuration load, a policy sync or a migration quietly removes a gate or invents a category. |
| **Partial failure** | A process dies between an external call and the record of its result, leaving the world ahead of the database. |
| **Ambiguity laundering** | A timeout, a dropped connection or an unrecognised response is recorded as a definite outcome. |
| **Replay** | A message that was already applied is delivered again. |
| **Self-review** | The principal that produced a change also clears it. |
| **Capacity leakage** | A scarce external resource is used twice because the database believed its lease had expired. |

## Trust boundaries

| Boundary | Owner | What it establishes |
|---|---|---|
| Identity | PR-C | Who a principal is, and what role it holds. |
| Transport | PR-G | That a message arrived once, intact, from an authenticated principal. |
| Source policy | PR-D | Which sources may assert which kinds of evidence. |
| Authority | PR-F | That an action is permitted, right now, on exactly this target. |
| Effect | PR-E | That an external call happened at most once and its outcome is known or explicitly unknown. |

A component never establishes its own boundary. In particular, authority is proved by
the authenticated issuance context and a durable principal record, never by a field
inside the message that requests it.

## Failure model

1. **The database is authoritative and transactional.** Anything that must be decided
   together is decided in one transaction.
2. **The external world is neither.** No transaction spans an external call. The
   strongest available property is *claimed, idempotent and reconcilable*, and the
   specification claims nothing stronger.
3. **A process may die at any instruction.** Every step therefore has a recorded,
   recoverable meaning; see [04-journal.md](04-journal.md).
4. **Clocks are injected.** All time-sensitive decisions read one authoritative clock
   so that expiry is testable and consistent across components.
5. **Unknown is a state, not an error.** It blocks; it does not resolve.

## Vocabulary

These words have exactly one meaning in this specification.

| Term | Meaning |
|---|---|
| **Task** | A unit of persisted work with a state, a lane and a history. |
| **Lane** | A persisted queue with limits. Not a worker, not an agent. |
| **Worker** | Disposable compute holding a claim. Never a source of truth. |
| **Principal** | An authenticated identity with a durable record and a role. |
| **State** | A member of the closed task vocabulary. |
| **Transition** | An explicitly permitted move between states. |
| **Event** | The named cause of a transition. |
| **Wait** | One gate episode: the question asked, and the answers that belong to it. |
| **Decision** | One Founder answer, carrying an explicit outcome. |
| **Outcome** | `APPROVED`, `DENIED` or `CANCELLED`. Never inferred from lifecycle state. |
| **Authorization / envelope** | The 25-field record that permits one action kind on one target. |
| **Redemption** | One use of an authorization, identified by its ordinal and key. |
| **Effect** | An action outside the database. |
| **Observation** | An immutable, append-only record of something a provider reported. |
| **Finding** | An observation asserting a defect, resolved only by an append-only event. |
| **Verdict** | A completed review attempt. An aborted attempt produces none. |
| **Claim / lease** | Time-bounded exclusive authority over a subject, fenced by a monotonic token. |
| **Fencing token** | A strictly increasing number proving which claim is current. |
| **Resource** | A named capacity the scheduler leases. |
| **Gate** | A persisted requirement that some category of action be authorised. |
| **Severity** | `BLOCKER`, `HIGH`, `MEDIUM`, `LOW`. A property of a finding only. |
| **Risk label** | `HIGHEST-RISK`, `HIGH-RISK`, `MODERATE`, `LOW-RISK`. A property of a slice only. |
| **Slice** | One PR in the Phase 0 sequence. |
| **Authority domain** | One authoritative database and the host that owns it. |
