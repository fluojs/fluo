# Native workflow threat model

## Trust boundary

The authenticated top-level OMO lead and the repository owner's local
filesystem are trusted. Search artifacts, child-task output, GitHub API
responses, persisted state read after interruption, and live Git/GitHub state
are untrusted until validated or reconciled.

The workflow does not claim to resist a malicious local repository owner who
can rewrite code, state, credentials, and history together. Event hashes detect
accidental corruption, stale/torn writes, and cross-process divergence; they
are not signatures against that trusted operator.

## Production authority

- Human approval comes from three separate native question turns observed by
  the trusted lead. Approval-binding digests prevent accidental plan
  substitution and consumed IDs prevent replay; neither is an authentication
  signature.
- Only the lead may execute GitHub issue/PR mutations, merge, cleanup, or root
  synchronization after the user grants the applicable side-effect authority.
- Successful receipts are written only from fresh live Git/GitHub command
  output bound to lane, issue, branch, worktree, PR, and head.
- Child tasks and caller-authored JSON can request or report work but never
  prove approval or a completed side effect.

## Fixture boundary

Files under a skill's `scripts/fixtures/` directory are deterministic contract
exercisers. They require `--fixture-only`, accept synthetic observations, and
must never be invoked as a production approval or side-effect authority path.
Their receipts and events are test evidence only.

## Filesystem controls

Native publishers reject symlinked output directories and exclusive-write
collisions. The lane state store rejects symlinked state files, writes a
transaction journal before each transition, recovers incomplete transactions,
requires exact append-only event prefixes, and atomically replaces snapshots
and receipt sets.
