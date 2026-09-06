# SBALT Development Orchestrator

Phase 0-A1. One capability exists:

```
dev-orch db:init --db /absolute/path/orchestrator.sqlite
```

It opens the named SQLite database, applies one immutable clean v1 migration if the path does
not yet exist, and on any later run confirms the same version and checksum are still
recorded. Nothing else is implemented.

Requires Node >= 22, matching the pinned `better-sqlite3` 13.0.3 (bundled SQLite 3.53.4).

## Where this tool is meant to run

`db:init` is approved for **a trusted local directory under the operator's control**, with no
external process substituting the directory, the target, or a symlink along the path while it
runs.

That does **not** exclude ordinary contention between copies of this tool: several `db:init`
processes may race to create the same target for the first time, and exactly one will create
it while the others report `already_at`.

## What holds inside that boundary

* An existing file is never overwritten, truncated, repaired or recovered. Existing targets
  are opened read-only.
* A symlink, directory, FIFO, socket or other non-regular file in the target position is
  refused and never followed.
* A recovery sidecar (`-journal`, `-wal`, `-shm`) refuses the target whether or not the
  database itself is present.
* Only a path that does not exist is initialised, and it is published whole: the database is
  built under a temporary name in the same resolved directory and linked into place with a
  no-clobber `link()`, never a `rename()`.
* A path is accepted only if it is absolute, lexically canonical, and unchanged by the
  trimming the SQLite driver applies before opening it.

## Accepted limitations

These are limits of the approved boundary, not defects that were fixed. None of them is
claimed to be eliminated.

**Malicious TOCTOU is out of scope.** Verification and publication identify files by
pathname. Node does expose `O_NOFOLLOW`, so a no-follow *open* is possible; what is missing is
a way to keep that identity — `better-sqlite3` accepts a filename and opens it itself, with no
API for handing an already-open file to SQLite. An attacker able to rename or retarget entries
in the parent directory during a run can therefore break the correspondence between the file
this tool verified and the file SQLite later opens. Inside a trusted directory this cannot
happen; outside one, it is a real exposure and this tool does not defend against it.

**Power-loss durability is unverified.** The database file and the parent directory are
flushed before `applied` is reported, and a failure to flush is reported as a failure rather
than swallowed. The ordering and the failure propagation are tested. Whether a given
filesystem and platform actually preserve the entry across a power loss is not tested and is
not claimed.

**A killed process can leave a temporary database behind.** If this tool is killed with
SIGKILL between creating its temporary file and cleaning it up, a `.dev-orch-init-*` file
remains in the target's directory. Nothing reclaims it: this tool never deletes files it did
not create in the current run, and it never deletes another process's temporary files or an
existing database. Removing a leftover is a manual decision.

## Verification

```
npm ci
npm test          # builds a CLI for the run; does not read or require dist/
npm run build
```

`npm test` and a bare `vitest run` are equivalent — the suite compiles what it needs into a
directory belonging to that run and removes it afterwards, so it never depends on, and never
reuses, a previous build.
