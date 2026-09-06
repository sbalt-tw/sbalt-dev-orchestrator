# SBALT Development Orchestrator

Phase 0-A1. One capability exists:

```
dev-orch db:init --db /absolute/path/orchestrator.sqlite
```

It opens the named SQLite database, applies one immutable clean v1 migration if the path does
not yet exist, and on any later run confirms the same version and checksum are still
recorded. Nothing else is implemented.

## Supported platforms and formats

**Linux and macOS only**, on a local filesystem, with SQLite databases in the **rollback
journal** format.

* **Windows is not supported.** Durable publication flushes the parent directory, which is
  not available through this API on Windows: `FlushFileBuffers` requires write access that a
  read handle does not have. The package declares `os: ["linux", "darwin"]`, and the runtime
  refuses an unsupported platform before it touches any database. Windows has not been tested
  and is not claimed to work.
* **Write-ahead-log databases are not supported.** A WAL database is refused by reading the
  file header before any connection is opened, because opening one — even read-only — makes
  SQLite create `-wal` and `-shm` files. Nothing is converted, no existing sidecar is deleted,
  and the `immutable` open flag is not used to bypass the check.

Requires Node >= 22, matching the pinned `better-sqlite3` 13.0.3 (bundled SQLite 3.53.4).
`package.json`, the lockfile root and the runtime all state the same boundary.

### CPU architectures

`package.json` and the lockfile root declare `cpu: ["x64", "arm64"]`. What that declaration
does and does not mean:

| | |
|---|---|
| **Tested** | `darwin-arm64` (development machine) and `linux-x64` (CI runner) |
| **Prebuilt binary ships, not tested here** | `darwin-x64`, `linux-arm64`, and the musl variants `linuxmusl-x64`, `linuxmusl-arm64` |
| **Not supported this round** | every other CPU. The driver's loader falls back to `build/Release/better_sqlite3.node`, and the package has `gypfile: false` with no install script, so a default `npm ci` produces no usable binding. A manual source build may work; it is untested and out of scope here |

A shipped prebuilt binary is not evidence that a target was tested. Nothing here extends
support to other platforms.

## Where this tool is meant to run

`db:init` is approved for **a trusted local directory under the operator's control**, with no
external process substituting the directory, the target, or a symlink along the path — or
changing a database's journal mode — while it runs.

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
* A database is only recognized if its header declares the rollback journal format.

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

**A publication can succeed while something after it fails.** Four facts are tracked
separately and never stand for one another: whether this run published a target, whether the
published name was afterwards confirmed to be the file this run built, whether the directory
entry was flushed, and whether this run removed its own temporary file.

| Outcome | Meaning |
|---|---|
| `E_PUBLISHED_IDENTITY_UNCONFIRMED` | published, but the name could not afterwards be confirmed as the verified file |
| `E_PUBLISHED_NOT_SYNCED` | published and confirmed, but the directory entry was not flushed |
| `E_TEMPORARY_NOT_REMOVED` | the operation itself completed, but this run could not remove its own temporary file. It says nothing about whether this run published anything — it is also reached after losing a race, where this run published nothing |

**A published target is never removed on failure.** Deleting it to simulate a rollback would
destroy state this tool had already handed over. A later run reporting `already_at` means the
version is recognized; it is not evidence that any earlier flush reached the disk. A cleanup
failure never overwrites one of the errors above, and never passes as success.

**A killed process can leave a temporary database behind.** If this tool is killed with
SIGKILL between creating its temporary file and cleaning it up, a `.dev-orch-init-*` file
remains in the target's directory. That is distinct from an ordinary cleanup failure, which
is reported as `E_TEMPORARY_NOT_REMOVED` rather than passing silently. Nothing reclaims
either: this tool never deletes files it did
not create in the current run, and it never deletes another process's temporary files or an
existing database. Removing a leftover is a manual decision.

## Verification

```
npm ci
npm test          # builds a CLI for the run; does not read or require dist/
npm run build
```

The migration checksum accepts a positive safe-integer version and well-formed statements;
anything else is refused rather than silently coerced. The encoding is injective over that
domain — a property of the encoding, not of SHA-256: no claim is made that a hash collision
is mathematically impossible. A1's only production caller is the frozen v1 constant, which
cannot supply an illegal value.

`npm test` and a bare `vitest run` are equivalent — the suite compiles what it needs into a
directory belonging to that run and removes it afterwards, so it never depends on, and never
reuses, a previous build.
