# 11 · PR #1 disposition

PR #1 (`feat/bootstrap-orchestrator`, head `428ae75e91fa1dd23c371d5f7af745aba0bec7fd`)
is the Phase 0 bootstrap that five review rounds failed to converge. It stays **open,
unmerged and unmodified**. Its branch and its full review history are retained: they are
the only durable record of rounds 1–5, and [14-findings.md](14-findings.md) depends on
them.

## Strict ordering

| Step | Action | Gate |
|---|---|---|
| 1 | Plan v2.2 delivered | done |
| 2 | Founder approves D1–D10 and authorises D11 | Founder |
| 3 | PR-0 opens | on authorisation |
| 4 | PR-0 reviewed at its exact head, findings resolved, merged | review + Founder merge |
| 5 | Founder **separately** authorises closing PR #1 | Founder |
| 6 | PR #1 closed unmerged with a superseded note linking PR-0; branch and full review history retained | on authorisation |
| 7 | Only then may PR-A open | on authorisation |

The ordering is strict; there is no permitted reordering. PR-0 may coexist with an open
PR #1 because PR-0 is not an implementation PR and does not consume the lane's
implementation-PR slot. PR #1 must not be closed before PR-0 has merged and closure has
been separately authorised.

## Prohibited at every step before step 5

* Force-pushing, rebasing, cherry-picking or otherwise rewriting PR #1's commits.
* Closing, modifying or commenting on PR #1.
* Moving PR #1's runtime code into PR-0.
