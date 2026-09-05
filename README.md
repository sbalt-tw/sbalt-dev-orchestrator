# SBALT Development Orchestrator

Durable task and lane orchestration for multi-agent software development workflows. An
independent infrastructure repository: it is **not** part of the SBALT application runtime.

## Where the rules are

[`spec/CONSTITUTION.md`](spec/CONSTITUTION.md) is the Phase 0 constitution. It holds
governance only — who owns a specification, how large a thing may be reviewed at once, what
counts as proof, and in what order work proceeds. It contains no domain design.

Domain specification lives in per-stage **pre-implementation checkpoints**, each merged
immediately before the implementation it governs, each carrying its own Founder decision.
None exists yet. Phase 0 is a closed registry of nineteen stages; the constitution is the
first.

## State of the repository

| | |
|---|---|
| Current stage | `PR-C0`, the constitution — docs-only; no runtime source, no schema, no migration |
| Next | `SPEC-A`, once the constitution has merged |
| Reviewed baseline | `NOT_ESTABLISHED` — none exists, and none is established before merge |
| Phase 1A | closed; every real integration is disabled |
| Superseded | two earlier pull requests remain open and unmerged; closing them needs its own authorisation |

## Commands

```
npm ci
npm run spec:validate   # structural validation, and change detection once a baseline exists
npm run typecheck
npm run lint
npm test
```

`npm run build` compiles `src/`, which this stage does not ship. It fails identically on
the base commit for the same reason, and the build configuration is deliberately not
relaxed to hide that. Later stages legitimately add runtime, and nothing here prevents it.

A passing validator means the artifact is well-formed. **It is not a claim that the
specification is right, and while the baseline is `NOT_ESTABLISHED` it is not a claim that
anything is unchanged.** See `spec/CONSTITUTION.md` §1.3 and §1.4.
