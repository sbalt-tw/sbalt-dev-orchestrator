# 07 · Lossless canonical identity

Blanket lowercasing is prohibited. Case folding is lossless only where the underlying
alphabet is case-insensitive; applying it to a Git ref conflates two different branches,
and an authorization for one would redeem against the other.

| Identity | Authoritative form | Rule |
|---|---|---|
| repository | Provider immutable repository ID: `repo:github:R_kgDO…` | The display slug (`org/name`) is stored beside it and is never authoritative — a repository can be renamed or transferred. |
| git ref | Byte-exact, full `refs/heads/…`, no abbreviation | No case folding, no normalisation, no Unicode transformation. Compared byte-for-byte. |
| commit | Full 40-character hex, lowercased | Lowercasing is permitted *only* because Git object names are hexadecimal, so it loses nothing. A branch name is never substituted for a SHA. |
| environment | Immutable environment ID | A renameable display name is never authoritative. |
| resource · policy · finding | Stable immutable orchestrator IDs | Key paths and human labels are display only. |
| principal | `principal:<uuid-v4>` | A display name never identifies a principal. |
| serialization | Versioned, deterministic, unambiguous | Fixed field order, explicit types, no locale dependence, a separator that cannot occur inside a field. The version is part of what is hashed. |

A target that cannot be canonicalized — unknown provider, unresolvable ID, ambiguous
encoding — is **refused**. It is never guessed at and never auto-corrected.

This table and the `canonical_target` column of
[`manifests/action-matrix.json`](manifests/action-matrix.json) must agree; the validator
checks that every canonical target form used by an action kind is one of the schemes
declared here.
