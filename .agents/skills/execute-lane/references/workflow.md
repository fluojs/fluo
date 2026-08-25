# Native execute-lane workflow

## Persisted truth

- Ready input: `.omo/lanes/<lane-id>.json`
- Runtime snapshot: `.omo/lane-runs/<lane-id>/snapshot.json`
- Events: `.omo/lane-runs/<lane-id>/events.jsonl`
- Receipts: `.omo/lane-runs/<lane-id>/receipts.json`
- Lease: `.omo/lane-runs/<lane-id>/lease.json`
- DAG binding: `.omo/lane-runs/<lane-id>/dag-binding.json`
- Issue runtime: `.omo/lane-runs/<lane-id>/issues/<issue-number>/`

Acquire a per-ledger lease, validate the v2 snapshot and event hash chain, and
reconcile live branch, worktree, PR, head, checks, and issue identity before
resuming.

`release_handoffs` does not mean “Changeset required.” It contains only issues
whose core task is release or publishing. Those issues are never dispatched to
implementation and terminally park at `blocked-maintainer-decision`. When
multiple handoffs exist, already parked items may coexist with untouched queued
handoffs while the root status remains `running`.

Before accepting any non-empty handoff set, load the consumed `lane-plan`
approval receipt and require its issue numbers to match the ledger exactly.
Each receipt attestation must retain the approved issue evidence digest,
`decision: "release-or-publish-is-core"`, and `changeset_only: false`.
Recompute the receipt binding and require it to equal the independent
`lane_plan_approval_sha256` stored in the ready ledger.

## DAG projection

Compile the validated lane through `scripts/compile-dag.mjs`. The definition
contains one `issue-<number>-supervisor` node per confirmed issue, and
`dependsOn` exactly mirrors `dependency_graph`. Every executable node owns a
disjoint issue worktree and the complete issue lifecycle. Approval-bound
release handoff nodes perform no implementation and park at
`blocked-maintainer-decision`.

Start the definition with the native DAG tool, then atomically persist its key,
run ID, definition digest, and current event hash through
`scripts/dag-binding.mjs`. On restart, reconcile Fluo state and live identities
first, require the stored definition digest to match, and only then attach the
recorded run. A missing or conflicting run fails closed; DAG journal state never
overrides the lane ledger.

Each node initialises `scripts/issue-supervisor-store.mjs` under its issue
runtime directory. Every local review, remote observation, receipt, and status
transition is transactionally persisted there. The parent imports only a
validated terminal supervisor state through `scripts/supervisor-terminal.mjs`.

## Issue supervisor loop

```text
queued -> implementing -> local-review
local-review + fixable BLOCK -> implementing -> new head -> local-review
local-review + all PASS -> ready-for-pr
ready-for-pr -> observed push and PR creation -> ci-pending
ci-pending + fixable failure -> ci-fix-back -> new head -> local-review
local-review + all PASS and existing PR -> ready-for-push
ready-for-push -> observed push -> ci-pending
ci-pending + PASS -> merge-ready
merge-ready -> observed squash merge -> merged
merged -> observed cleanup -> done
human, external CI, policy, malformed output, or exhausted budget
  -> explicit terminal blocker
```

Before PR creation, the local triad consists of exactly one contract, code, and
verification result bound to the local commit head. Its successful aggregate is
`ready-for-pr`, never `merge`. Every fix preserves issue, branch, and worktree;
after PR creation it also preserves PR identity. Every fix produces a new head
and reruns the complete local triad.

CI must bind the same reviewed PR head. A code or test failure may enter
`ci-fix-back`. Infrastructure, missing, stale, policy, approval, or other
external failures enter human review without code mutation. A CI PASS on the
same reviewed head produces `merge-ready`; a fresh issue-supervisor observation
then performs and proves the merge.

No-progress, identical blocker repetition, total attempts, elapsed time,
malformed child output, stale approval, and ledger conflicts stop fail-closed.

## Side effects

Record each mutation as:

```text
INTENT event -> action -> live OBSERVED event -> candidate validation
-> atomic snapshot replacement
```

Issue supervisors may perform push, PR creation/update, squash merge, and
cleanup only when those operations are granted by the immutable lane authority.
Each operation requires a machine-readable target/head-bound receipt and fresh
live observation. The parent lead validates returned evidence and is the only
shared ledger writer. Root sync, cutover, rollback, and publication remain
parent-owned. Resume must prove the prior event stream is an exact immutable
prefix before appending. Local publishing is forbidden.

## Production live observations

The issue supervisor executes issue-bound checks directly; the parent lead
executes root-state checks. Nested child output and fixture JSON are not live
evidence:

```bash
gh pr view <pr> --json number,url,state,headRefName,headRefOid,mergeCommit,mergedAt
gh issue view <issue> --json number,state,url
git worktree list --porcelain
git show-ref --verify refs/heads/<branch>
git ls-remote --exit-code --heads origin <branch>
git status --porcelain
git pull --ff-only origin <base-branch>
git rev-parse HEAD
git rev-parse origin/<base-branch>
```

Before first push and every update, the issue supervisor verifies the complete
local triad against the commit head. Before merge, it verifies the reviewed
head, remote branch, `headRefOid`, and CI head are identical. After merge, it
requires `state: MERGED`, a non-null merge commit, and the linked issue
`state: CLOSED`. Cleanup receipts require the worktree and local/remote branch
queries to prove absence. The parent performs root sync only after all DAG nodes
are terminal; its receipt requires a clean primary checkout, successful
`pull --ff-only`, and equal local/remote base-branch SHAs.

`scripts/fixtures/run-replay.mjs --fixture-only` is a deterministic transition
exerciser and never grants or observes production side-effect authority.
