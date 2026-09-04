# Architecture

## The shape of the problem

A development workflow with several agents has three kinds of participant, and
conflating them is what makes these systems fragile:

1. Something that **reasons** about what to do next.
2. Something that **executes** work.
3. Something that **decides** whether the state may legally change.

The mistake is letting (1) or (2) also be (3). A reasoning component that can
declare its own output safe, or a worker that can assert it is ready to merge,
turns every gate into a suggestion. Here (3) is a deterministic engine over
durable state, and it does not take anybody's word for anything.

## Components

```
                 ┌────────────────────┐
                 │  GPT Coordinator   │  proposes an action
                 └─────────┬──────────┘
                           │  CoordinatorOutput (strict schema)
                           ▼
┌──────────────────────────────────────────────────────────┐
│                     Orchestrator                          │
│                                                           │
│  ┌────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │  Policy    │   │ State Engine │   │ Resource Mgr   │  │
│  │  (yaml)    │──▶│ (guards +    │◀──│ (leases,       │  │
│  │            │   │  transitions)│   │  capacity)     │  │
│  └────────────┘   └──────┬───────┘   └────────────────┘  │
│                          │                                │
│                   ┌──────▼───────┐                        │
│                   │    Store     │  SQLite, transactional │
│                   └──────────────┘                        │
└───────────┬───────────────────────────────┬──────────────┘
            │ DispatchIntent                │ ProjectAdapter (read-only)
            ▼                               ▼
     ┌─────────────┐                 ┌──────────────┐
     │   Workers   │  WorkerReport   │ Target repo  │
     │ (disposable)│ ───────────────▶│ (never       │
     └─────────────┘  strict schema  │  mutated)    │
                                     └──────────────┘
```

## Layering

| Layer | Responsibility | Knows about |
| --- | --- | --- |
| `domain/` | States, events, entities, the two wire contracts | Nothing else |
| `state/` | SQLite store, migrations, the state engine | domain, policy, dependencies |
| `policy/` | Policy schema, review model, Founder Gate | domain, store |
| `resources/` | Logical resource leases and capacity | domain, store, policy |
| `scheduler/` | Dependency DAG, reconciliation, the tick | store, engine, resources, policy |
| `workers/` | Provider abstraction, fake provider | domain |
| `coordinator/` | Coordinator contract, stub, validation | domain, store, policy |
| `projects/` | Project adapter boundary | domain |
| `cli/` | Operator surface | orchestrator |

The core scheduler contains no reference to any specific repository. Everything
project-shaped arrives through `ProjectAdapter`.

## Migrations

Version 1 is never edited. Later versions upgrade in place, because hardening an
early migration would leave every existing database unconstrained while the code
claimed otherwise.

Version 2 shipped before version 3 existed. Correcting version 2 in place would
have been invisible to any database that already recorded it as applied — the
same mistake version 2 was written to avoid — so its corrections live in
version 3.

A migration that rebuilds tables sets `rebuildsTables`, and the runner then
disables foreign keys **around** the transaction — `PRAGMA foreign_keys` is
ignored inside one — and runs `foreign_key_check` before committing, so a
migration that would break a reference rolls back instead. This is tested
against a populated version-1 database, not only a fresh one: an earlier
migration passed every fresh-database test while failing on any database that
actually had rows in it.

## Why SQLite

The workflow database has to survive a crash, be inspectable by a human at 2am,
and need no infrastructure to run on a laptop. `better-sqlite3` is synchronous,
which lets a scheduler tick read state, decide and write in one uninterrupted
transaction — the interleaving bugs that come with an async store simply do not
arise.

`node:sqlite` was considered and rejected for now: it is still flagged
experimental and its API may shift between Node releases, which is the wrong
foundation for shared infrastructure. The driver surface in use is small and
confined to `src/state/db.ts`, so revisiting that is a contained change.

Ad-hoc JSON files are explicitly not the system of record. JSON is used for
configuration and for exported reports only.

## Deterministic engine, advisory reasoning

The Coordinator returns a structured action. The orchestrator then:

1. parses it against a strict schema — unknown action or unknown key is rejected;
2. validates it against durable state and policy;
3. only then asks the state engine to apply an event;
4. and the engine independently re-checks its own guards.

So a Coordinator that hallucinates `READY_TO_MERGE` for a task with no clean
verdict is refused twice, by two components that do not share a code path with
it.

## What Phase 0 deliberately does not build

No Kubernetes, Temporal, Redis, message broker, web frontend or Docker
requirement. The whole thing runs on one developer machine with `npm install`
and `npm test`. Distribution is a problem to solve when there is something worth
distributing.

## Self-hosting boundary

`SELF_HOSTING = DISABLED`, and the policy schema will not parse
`selfHosting.enabled: true`.

The orchestrator must not develop itself in Phase 0. A system that can modify
its own scheduler, gates and policy while running is a circular-control risk: a
bug in the gate logic could authorise the change that entrenches the bug, and
the failure would be invisible from inside. The safe order is to trust it on
someone else's repository first, under a Founder Gate, and to keep changes to
this repository on the ordinary human-reviewed path.

When that boundary is eventually revisited, the minimum it should require is:
this repository as an ordinary target project with the same gates as any other,
no ability to modify its own policy file or gate logic through an automated
task, and a separate reviewed change to lift the restriction.
