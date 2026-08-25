# Native workflow threat model

## Trust boundary

The authenticated top-level OMO lead, authority-bound issue-supervisor DAG
nodes, and the repository owner's local filesystem are trusted. A supervisor is
trusted only for its immutable lane/issue/branch/worktree/PR identity and
`authority_scope`; its implementer and reviewer children remain untrusted.
Search artifacts, nested child-task output, GitHub API responses, persisted
state read after interruption, and live Git/GitHub state are untrusted until
validated or reconciled.

The workflow does not claim to resist a malicious local repository owner who
can rewrite code, state, credentials, and history together. Event hashes detect
accidental corruption, stale/torn writes, and cross-process divergence; they
are not signatures against that trusted operator.

## Production authority

- Human approval comes from three separate native question turns observed by
  the trusted lead. Approval-binding digests prevent accidental plan
  substitution and consumed IDs prevent replay; neither is an authentication
  signature.
- The parent lead owns shared lane state and root synchronization. An
  issue-supervisor node may execute push, canonical PR create/update, merge, and
  cleanup only for its bound issue after the user grants the applicable lane
  authority. The parent persists a dispatch intent, starts one issue run, then
  immediately binds the observed run ID. Reconciliation refuses an intent
  without a binding and attaches an exact binding without starting a duplicate.
  Nested implementers and reviewers never receive that authority.
- Successful receipts are written only from fresh live Git/GitHub command
  output bound to lane, issue, branch, worktree, PR, and head.
- The supervisor persists target-bound observations in its issue-local atomic
  state. The parent revalidates those receipts and live identity before
  importing terminal evidence into the shared lane ledger.
- Nested child tasks and unvalidated caller-authored JSON can request or report
  work but never prove approval or a completed side effect.

## Fixture boundary

Files under a skill's `scripts/fixtures/` directory and
`search-issue/scripts/run-scenario.mjs` are deterministic contract exercisers.
They require `--fixture-only`, accept synthetic observations, and must never be
invoked as a production approval or side-effect authority path. Their
artifacts, receipts, and events are test evidence only.

## Filesystem controls

Native publishers reject symlinked output directories and exclusive-write
collisions. Lane and issue-supervisor state stores reject symlinked state
paths, write transaction journals before transitions, recover incomplete
transactions, preserve append-only event hashes, and atomically replace
snapshots and receipt sets. DAG bindings are first-write exclusive and bind the
lane, issue, native run, one-node definition, canonical dependencies, and
dispatch event anchor. Legacy lane-wide v1 bindings remain immutable fences.
Blocked dependent terminalization requires fresh absence observations for its
issue store, local/remote branch, worktree, native task, and PR.
