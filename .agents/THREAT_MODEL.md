# Native workflow threat model

## Trust boundary

The authenticated top-level OMO lead and the repository owner's local
filesystem are trusted. Direct issue-DAG preflight, implementer, reviewer, and
operator nodes are untrusted claim producers. Search artifacts, child output,
GitHub API responses, native DAG projections, persisted state read after
interruption, and live Git/GitHub state remain untrusted until validated or
reconciled by the lead.

The workflow does not claim to resist a malicious local repository owner who
can rewrite code, state, credentials, and history together. Event hashes detect
accidental corruption, stale/torn writes, and cross-process divergence; they
are not signatures against that trusted operator.

## Production authority

- Human approval comes from three separate native question turns observed by
  the trusted lead. Approval-binding digests prevent accidental plan
  substitution and consumed IDs prevent replay; neither is an authentication
  signature.
- The parent lead owns shared lane state, issue-DAG start/attach/amend/recovery,
  issue transitions, terminal import, and root synchronization. It persists
  intent before every native effect and never replaces an attached run or
  adopts one from another coordinator session.
- Direct nodes receive one phase-bounded authority block. They never receive
  orchestration authority. Implementers mutate only the issue worktree;
  reviewers remain read-only under their axis contract; operators perform one
  issue-bound Git/GitHub action under existing user-granted lane authority.
- Successful receipts are written only from fresh live Git/GitHub command
  output bound to lane, issue, branch, worktree, PR, and head.
- The parent persists target-bound observations in issue-local atomic state and
  revalidates receipts and live identity before importing terminal evidence.
- Native node completion and unvalidated caller-authored JSON can report work
  but never prove approval or a completed side effect.

## Issue DAG boundary

Each admitted issue owns one native lifecycle v3 key, one immutable run ID, and
one coordinator parent session. Lifecycle nodes are direct DAG children and
cannot call `task`, `dag`, team, or task-control tools. Project agent policy
denies those tools at depth 1; runtime task/session verification detects an
actual forbidden call.

The parent cross-links the native key record, run checkpoint, generation,
definition fingerprint, append-only amendment event, node task attachment,
task owner `{runId,nodeId,fingerprint}`, parent session, terminal dispatch,
session logs, machine result, current issue event hash, and live Git/GitHub
state. A stale head, changed/invalidated historical node, substituted owner,
partial reviewer wave, or conflicting amendment fails closed.

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
snapshots and receipt sets. Issue-DAG control bundles bind lane, issue, native
run, coordinator, generations, current and pending definition digests, native
fingerprints, phase/node IDs, and terminal issue event hash. Old lane-wide,
per-issue-v2, and relay state has no production loader and requires an approved
successor lane.
Blocked dependent terminalization requires fresh absence observations for its
issue store, local/remote branch, worktree, native task, and PR.
