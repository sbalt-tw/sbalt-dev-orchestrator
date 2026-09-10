# SBALT Development Orchestrator

Phase 0-A1. One capability exists:

```
dev-orch db:init --db /absolute/path/orchestrator.sqlite
```

It opens the named SQLite database, applies one immutable clean v1 migration if the path does
not yet exist, and on any later run confirms the same version and checksum are still
recorded. Nothing else is implemented.

## Supported platforms and formats

**Linux and macOS only**, on a filesystem with the capabilities listed below, with SQLite
databases in the **rollback journal** format.

**Required filesystem capabilities.** "Local" is not the contract — these are, and they follow
from the publication path rather than from a preference:

| Capability | Where it is used | If it is missing |
|---|---|---|
| `link()` within one filesystem, failing `EEXIST` instead of replacing | the database is built under a temporary name in the target's own directory and published with `link()`; `rename()` is deliberately not used because it replaces silently | publication cannot happen at all |
| `fsync()` on a regular file | the built database is flushed before it is published | durability cannot be established |
| `fsync()` on a **directory** | the parent directory is flushed so the new name survives a crash | the name's durability cannot be established |
| `stat`/`lstat` with stable `ino` and `dev` | after publishing, the target is re-identified as the very inode just verified | publication cannot be confirmed |

Notably **exFAT and FAT32 do not provide hard links**, so `db:init` cannot create a database on
them even though they mount locally on both supported platforms. **This is a permanent capability
mismatch, not a transient error: retrying does not help, and no amount of waiting makes it
succeed.** It surfaces as `E_CREATE_FAILED` after the temporary database has been built, which is
an unhelpfully generic report for a permanent condition — this tool does not currently probe the
filesystem's capabilities in advance or distinguish this case, and it is not claimed to.

**What has actually been exercised.** APFS, on macOS during development: the volume type was
confirmed on the very directory the suite uses, not inferred. CI runs on GitHub's
`ubuntu-latest`, and **the pipeline does not assert what filesystem that runner provides**, so no
specific Linux filesystem is claimed here — only that the suite passes there. Every other
filesystem, capable or not, is untested.

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

Several `db:init` processes may race to create the same target: one creates it, the rest
report `already_at`, or time out retryably (see *Contention* below).

### Supported inputs

**Created here (`applied`).** Built under a temporary name in this target's own resolved
directory, verified by the same read-only classifier, published with a no-clobber `link()`,
then flushed. This is the only case whose whole history is known.

**Reopened in place (`already_at`).** The core use. It requires three things of you, which
this tool cannot verify:

| | |
|---|---|
| **Writer** | only this tool writes the database; nothing else opens it read-write or changes its journal mode |
| **Path** | it stays at the absolute canonical path it was created at — not renamed, moved, or given an extra hard link |
| **Journal custody** | after a crash, the journal stays beside the database under its own name until recovery completes; it is never deleted, moved, or separated |

**The name's alphabet (enforced).** A database *name* may use only ASCII letters, digits, `.`,
`_` and `-`. The parent directory is unrestricted — only the name this tool has to reason about.
Anything else is refused with `E_DB_PATH_NAME_UNSUPPORTED` before anything is created. The check
reads the name exactly as given: it is never normalized, decomposed or transliterated first,
because that would accept the spellings the rule exists to exclude. The reason is that
case-insensitive filesystems fold far more than ASCII case — on APFS `a.sqlite-ſhm` (U+017F) and
`a.sqlite-shm` are one directory entry — so a name this tool treated as distinct could still land
in another database's recovery namespace. Restricting the alphabet is narrower and more
predictable than tracking each filesystem's folding rules.

**Reserved names (enforced, not a convention).** A database name may not end in `-journal`,
`-wal` or `-shm`. Those are the names SQLite gives the sidecars of the database one suffix
shorter, so a database allowed to take one would sit inside another database's recovery
namespace and make that one report `E_DB_RECOVERY_REQUIRED` forever. `db:init` refuses such a
target with `E_DB_PATH_SIDECAR_RESERVED` before it creates anything, whether or not the shorter
name exists yet, and regardless of which of the two you create first. The comparison ignores
**ASCII** case on every platform, so `-JOURNAL` is refused too; it does not attempt Unicode case
folding, and does not need to, because the alphabet rule above has already excluded every
character whose folding differs between filesystems.

**`already_at` proves, at the moment of checking:** the path is absolute, canonical, with a
resolved parent and no characters the driver would trim; the target is a regular file with
one name; no `-journal`, `-wal` or `-shm` sits beside *that* name; the header declares the
rollback-journal format; `sqlite_master` holds exactly the one v1 table with exactly the v1
CREATE text; and the registry holds exactly one row — version 1 with the frozen checksum.

**It does not prove:** that no recovery is pending on the inode; that this is the file this
tool created; that no other writer has it open; or that any earlier flush reached the disk.

**Unsupported.** Alias writes outside this tool's flow, arbitrary rename or move, incomplete
restore, and adopting a foreign database. These are not merely discouraged — see the split
below, because some of them this tool cannot detect at all.

## What holds inside that boundary

* An existing file is never overwritten, truncated, repaired or recovered. Existing targets
  are opened read-only.
* Only a path that does not exist is initialised, and it is published whole: the database is
  built under a temporary name in the same resolved directory and linked into place with a
  no-clobber `link()`, never a `rename()`.
* A target reachable under more than one name **at the time of checking** does not yet meet
  the conditions for classification. Nothing belonging to another process — no temporary
  file, no alias, no journal — is ever removed to make a check pass.

**What this tool refuses, and what it cannot see.** The difference matters more than the list:

| Refused, on technical evidence | Relies on your discipline; not detectable here |
|---|---|
| write-ahead-log or unknown header format | **a journal left beside a name the database no longer has** |
| a sidecar beside the given name | a file that was renamed, copied, or restored from backup |
| more than one name, after the wait | whether a recovery ever completed |
| symlink, directory, FIFO, socket, empty file, non-canonical path | whether another writer has it open |
| unrecognized schema, registry, version or checksum | whether this tool created it |

Nothing in the right-hand column is closed by declaring it unsupported: this tool **accepts
such inputs silently** rather than refusing them.

**Order of checks.** The link count, sidecars, file kind and size, and the header are
filesystem operations performed **outside any SQLite transaction**, each observing its own
moment. Only the schema and registry reads share one read transaction.

**Order of publication.** Flush the file, `link()`, confirm identity, flush the parent
directory, then **attempt cleanup of this run's temporary name**. Only after that does a
single exit decide what to return or raise, from the primary error and the cleanup result
together — cleanup can neither overwrite a primary error nor pass silently when it fails. The
command prints nothing until that decision is made: the successful return value is produced
after the cleanup attempt, not before it.

**Contention.** `E_DB_TARGET_ALIASED` says only that the target does not yet meet the
conditions for classification. It is **not** evidence that the database is damaged — a slow but
legitimate publisher produces exactly this outcome, and there a retry is the right response. The
deadline is measured on a monotonic clock and bounds the *waiting strategy*; it is not a promise
that the command finishes within any number of seconds, since the process can be descheduled and
filesystem calls can block.

**It does not follow that every cause is retryable.** The code reports one observation — the
target currently has more than one name — and several situations produce it. A concurrent
publisher clears on its own. A hard link made deliberately, or left by something outside this
tool, does not clear no matter how long you wait, and the target stays refused until that other
name is removed. Round 13 fixed one such source in this tool: an interrupted run used to strand
its own temporary name, which wedged the path permanently while the message suggested waiting.
Interpret the message as "not classifiable right now", not as "waiting will fix it".

## Accepted limitations

These are limits of the approved boundary, not defects that were fixed. None of them is
claimed to be eliminated.

**An interrupt that has been delivered but not yet dispatched may not reach the report.**
`db:init` installs handlers for SIGINT, SIGTERM and SIGHUP, does its work, then passes through
the event loop before deciding what to print. That is enough to keep cleanup correct, and enough
that an interrupt is normally observed — but it is not a guarantee. The operating system can
deliver a signal *before* the decision and dispatch its JavaScript handler *after* it. This is
not the same as "the signal arrived once the work was already finished": the signal genuinely
arrived first, and was still missed. When that happens the command prints the result it actually
completed and exits normally, and the exit disposition is not guaranteed to match the signal that
was sent. Adding more timers or yields only moves the sampling point; removing it would take a
lifecycle with an explicit completion boundary, which this tool has not adopted.

What is **not** accepted, and is enforced by the real-signal regressions: an interrupt that was
observed is never ignored; success is never reported for an operation that did not complete; a
primary error or a cleanup failure is never hidden behind a success; and none of SIGINT, SIGTERM
or SIGHUP may strand this run's temporary and leave the path wedged.

**A database whose journal was separated from it is accepted.** If the other name is unlinked
or renamed away while its `-journal` remains, the surviving file has one name and no sidecar
of its own, and is reported `already_at` while that inode still has a transaction to roll
back. This is **open, and accepted for the controlled use above — not technically closed.**
The scope note is SQLite's rollback-journal pairing specifically: recovery state lives in a
file named after a path, so separating the two hides it. It is not a claim about every
journal mode. No source verification, writer exclusion or recovery guarantee has been added,
and this contract covers today's A1 only — a future writer or persistence feature must be
re-examined rather than inheriting "only this tool writes".

**Malicious TOCTOU is out of scope.** Verification and publication identify files by
pathname. Node does expose `O_NOFOLLOW`, so a no-follow *open* is possible; what is missing is
a way to keep that identity — `better-sqlite3` accepts a filename and opens it itself, with no
API for handing an already-open file to SQLite. An attacker able to rename or retarget entries
in the parent directory during a run can therefore break the correspondence between the file
this tool verified and the file SQLite later opens. Inside a trusted directory this cannot
happen; outside one, it is a real exposure and this tool does not defend against it.

**Power-loss durability is unverified.** A failure to flush is reported rather than swallowed,
and the ordering and failure propagation are tested. Whether a given filesystem and platform
preserve the entry across a power loss is not tested and is not claimed.

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

**The migration encoder is internal, and no longer offered for general use.** It had no
production caller: `db:init` compares a database's recorded checksum against the frozen
`V1_CHECKSUM` literal and never encodes anything at run time. Exporting a general-purpose
encoder meant promising it stayed injective for arbitrary caller-supplied objects — including
objects whose property reads run JavaScript — and review found that promise still unmet. Rather
than keep extending the defence, the promise was withdrawn: `canonicalBytes` and `checksumOf`
are module-private and are not emitted as exports. Being private is not claimed as a security
boundary; it simply means no caller-supplied migration reaches that code.

**The supported interface is the CLI, and only the CLI.** An earlier version of this section
claimed the package could not be imported at all because `package.json` declares only `bin`.
That was wrong, and the correction matters more than the claim did: omitting an `exports` map
does not block deep subpath imports, so a workspace or file-installed consumer can still load a
compiled module such as `dist/db/migrate.js` directly. No `exports` map has been added. What is
true is narrower: nothing here is offered as a stable library API, the emitted modules may change
shape at any time, and `canonicalBytes`/`checksumOf` are genuinely absent from them — so the
withdrawal holds even though deep imports remain technically possible.

What is still guaranteed is narrower and checkable: the released identity of version 1.
`V1_DERIVED_CHECKSUM` is computed inside the module from the frozen `V1`, so it fails if `V1`
and its literal ever drift apart, and the suite additionally reads the checksum back out of a
database produced by the real `initialise`. No claim is made that a SHA-256 collision is
mathematically impossible; that remains an assumption about the hash.

`npm test` and a bare `vitest run` are equivalent — the suite compiles what it needs into a
directory belonging to that run and removes it afterwards, so it never depends on, and never
reuses, a previous build.
