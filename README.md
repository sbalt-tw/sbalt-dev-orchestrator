# SBALT Development Orchestrator

Durable task and lane orchestration for multi-agent software development workflows. An
independent infrastructure repository: it is **not** part of the SBALT application runtime.

## Where the rules are

[`spec/CONSTITUTION.md`](spec/CONSTITUTION.md) is the Phase 0 constitution. It holds
governance only — who owns a specification, how large a thing may be reviewed at once, what
counts as proof, and in what order work proceeds. It contains no domain design.

Domain specification lives in per-slice **pre-implementation checkpoints**, each merged
immediately before the implementation it governs, each carrying its own Founder decision.
None exists yet.

## State of the repository

| | |
|---|---|
| Current slice | the constitution — docs-only; no runtime source, no schema, no migration |
| Next | checkpoint SPEC-A, once the constitution has merged |
| Phase 1A | closed; every real integration is disabled |
| Superseded | two earlier pull requests remain open and unmerged until the constitution merges; closing them needs its own authorisation |

## Commands

```
npm ci
npm run spec:validate   # structural validation and change detection only
npm run typecheck
npm run lint
npm test
```

`npm run build` compiles `src/`, which this slice does not ship. It fails identically on
the base commit for the same reason, and the build configuration is deliberately not
relaxed to hide that.

A passing validator means the specification is well-formed and unchanged since review. It
does not mean the specification is right; see `spec/CONSTITUTION.md` §1.3.
