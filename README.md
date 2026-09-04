# SBALT Development Orchestrator

Durable orchestration for a multi-agent software development workflow.

The problem it solves: today a human sits between the reasoning component, the
implementation workers, git, GitHub, CI, the reviewer and the approval gates,
relaying state by hand. That human is a message bus, and a message bus should
not be a person. This project moves the bus into software so development
continues automatically until a deterministic policy — or the Coordinator —
identifies a decision that genuinely belongs to a human.

This is **not** part of any application runtime. It is engineering
infrastructure and lives in its own repository.

Phase 0 is the foundation: durable state, a finite state machine, dependencies,
resources, the Founder Gate, the review model, and the contracts that workers
and the Coordinator speak. There is no live agent integration yet.

---

## Vocabulary

| Term | Meaning |
| --- | --- |
| **GPT Coordinator** | The reasoning component. Proposes actions; never the final gate. |
| **Worker** | Disposable compute that executes a task. Currently a fake provider; Claude Code later. |
| **Codex Reviewer** | An independent reviewer whose verdict is consumed structurally, not as prose. |
| **Founder Gate** | A human authority. The only thing that opens a gated action. |
| **Lane** | A persistent stream of work and responsibility. |
| **Task** | A unit of work inside a lane, with its own state, dependencies and history. |

**A Lane is not a Worker.** A lane persists; a worker is a resource assigned to
a task for as long as it happens to live. There is deliberately no permanent
"Agent 1 / Agent 2 / Agent 3" concept anywhere in the schema or the scheduler.

## The core principle

> Persist Tasks and Lanes; treat Workers as disposable compute.

Workers may spawn, die, restart, change provider or change count. Nothing about
the workflow is stored inside one. Task state, lane state, dependencies, PR and
head state, review history, Founder decisions, resource ownership and policy
decisions all live in SQLite and survive any worker — and any orchestrator
process — going away.

## Getting started

Requires Node 20.11 or newer. macOS and Linux are both supported; nothing here
depends on either.

```bash
git clone <this repo>
cd sbalt-dev-orchestrator
npm install

cp .env.example .env                      # optional; no secrets are needed in Phase 0
cp config/policy.example.yaml config/policy.yaml   # optional; defaults are used otherwise

npm test          # 70 deterministic tests, no network
npm run typecheck
npm run lint
```

Initialise local state and look around:

```bash
npx tsx src/cli/index.ts init
npx tsx src/cli/index.ts status
npx tsx src/cli/index.ts demo      # synthetic end-to-end walkthrough
```

After `npm run build` the same commands are available as `dev-orch`.

## A five-minute tour

```bash
# Create a lane and a task.
dev-orch lane create --project demo --name core --risk HIGH
dev-orch task create --lane <laneId> --title "implement thing" --type IMPLEMENTATION

# Workers are disposable; add as many as the machine can carry.
dev-orch worker add --provider fake
dev-orch worker add --provider fake

# One deterministic scheduling pass.
dev-orch scheduler tick

# Why is something stuck?
dev-orch task show <taskId>

# Founder Gate.
dev-orch decision list --open
dev-orch decision resolve <decisionId> --resolution "approved"
```

Every command accepts `--json`.

## What is enforced, not merely intended

- **Gated actions need an approval, not just an answer.** Merging, writing to a
  remote environment, destructive operations and rollback are all gated. A
  worker that reports `SAFE_TO_MERGE` in prose changes nothing; only a
  `FounderDecision` for that task, in that category, resolved with outcome
  `APPROVED`, opens the gate. A refusal anywhere in a category wins regardless
  of order, a cancellation is not an approval, and a decision for one task does
  not authorise another.
- **An interruption is not a way around a human.** A task interrupted while
  awaiting a decision comes back still awaiting it, and no task with an
  outstanding decision is ever dispatched.
- **Validated policy is frozen.** The parsed policy is deeply immutable, so
  nothing can widen a budget or open a gate at runtime.
- **Merge readiness is anchored to an exact head.** A clean verdict on an older
  commit does not make the current commit mergeable.
- **An infrastructure-killed review costs no round.** Budget exhaustion should
  mean reviewers looked and still found something, not that the machine ran out
  of disk three times. This is not a configurable toggle.
- **Phase-0 gates cannot be configured away.** The policy parser accepts only
  `founderRequired` for merge and remote writes, so no config file can open a
  gate.
- **Malformed input fails closed.** Worker reports and Coordinator output are
  validated against strict schemas; unknown fields and unknown actions are
  rejected rather than guessed at.
- **A crash does not mean success.** After a restart, a task left `RUNNING` with
  an expired lease becomes `BLOCKED_INFRA`. Re-running it is an explicit
  decision, never an automatic side effect.

## Configuration

Policy is a file, not code — see `config/policy.example.yaml`. Worker count,
review budgets, lane PR limits, resource capacities and every gate are
configuration.

Paths come from the environment, never from committed absolute paths:

```bash
SBALT_REPO_PATH=/path/to/your/checkout
DEV_ORCH_DB_PATH=.dev-orch/state.sqlite
DEV_ORCH_POLICY_PATH=config/policy.yaml
```

No secret is stored in SQLite. `.env` is gitignored and Phase 0 needs no API
key at all.

## Boundaries in Phase 0

| | Status |
| --- | --- |
| Live Claude / worker integration | Not implemented (fake provider only) |
| Live GPT Coordinator | Not implemented (deterministic stub) |
| Live Codex integration | Not implemented |
| Auto-merge | Disabled; merge is founder-gated |
| Staging / production writes | Founder-gated, and no adapter can perform them |
| Self-hosting | Disabled — see `docs/architecture.md` |
| Mutating a target project | Impossible; the adapter surface is read-only |

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — components, layering, self-hosting boundary
- [`docs/state-machine.md`](docs/state-machine.md) — states, events, transitions, guards
- [`docs/worker-model.md`](docs/worker-model.md) — lanes vs workers, capabilities, dynamic pools
- [`docs/founder-gates.md`](docs/founder-gates.md) — what is gated and how a gate opens
- [`docs/review-policy.md`](docs/review-policy.md) — rounds, budgets, exact-head merge gating
- [`docs/recovery.md`](docs/recovery.md) — crash, restart, stale leases
