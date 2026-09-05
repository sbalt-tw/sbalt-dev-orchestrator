# SBALT Development Orchestrator

Durable task and lane orchestration for multi-agent software development workflows.
An independent infrastructure repository: it is **not** part of the SBALT application
runtime.

## Where the truth is

[`spec/`](spec/README.md) is the canonical Phase 0 specification. It is self-contained:
every rule, manifest, decision and gate is there, and nothing requires reassembling a
plan document or a conversation to understand.

Start with [`spec/README.md`](spec/README.md).

## State of the repository

| | |
|---|---|
| Current slice | **PR-0**, specification-only — no runtime source, no schema, no migration |
| Next slice | PR-A (durable core), not yet opened |
| Phase 1A | closed; every real Claude, GPT, Codex, staging and production integration is disabled |
| PR #1 | the superseded bootstrap; open, unmerged and unmodified by design — see [`spec/11-pr1-disposition.md`](spec/11-pr1-disposition.md) |

## Commands

```
npm ci
npm run spec:validate   # mechanical checks over the specification
npm run spec:render     # regenerate spec/01-invariants.md from its manifest
npm run typecheck
npm run lint
npm test
```

`npm run build` compiles `src/`, which this slice does not ship; it returns with PR-A.
