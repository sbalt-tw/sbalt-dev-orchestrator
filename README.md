# SBALT Development Orchestrator

An independent infrastructure repository. It is **not** part of the SBALT application
runtime, and the orchestrator it describes does not exist yet.

This file is navigational, not normative. Nothing here is a rule.

## Where the rules are

[`spec/C0-A.md`](spec/C0-A.md) is the first slice of the Phase 0 constitution. It covers
five things: authority and proof classes, the external baseline lifecycle, the exact review
tuple, exact-head CI evidence, and global reviewer capacity. Later slices cover the rest;
none exists yet.

## State of the repository

| | |
|---|---|
| Current slice | `C0-A`, docs-only — no runtime source, no schema, no migration |
| Baseline | `NOT_ESTABLISHED` — none exists, and none is created before merge |
| Superseded | three earlier pull requests; two remain open and unmerged, one is closed unmerged |

## Commands

```
npm ci
npm run typecheck
npm run lint
```

`npm run build` compiles `src/`, which this repository does not ship. It fails identically
on the base commit for the same reason, and the build configuration is deliberately not
relaxed to hide that.

There is no semantic validator here, and a green check is not evidence that anything in
`spec/` is correct.
