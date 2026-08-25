# Native execute-lane workflow

## Persisted truth

- Ready input: `.omo/lanes/<lane-id>.json`
- Runtime snapshot: `.omo/lane-runs/<lane-id>/snapshot.json`
- Events: `.omo/lane-runs/<lane-id>/events.jsonl`
- Receipts: `.omo/lane-runs/<lane-id>/receipts.json`
- Lease: `.omo/lane-runs/<lane-id>/lease.json`

Acquire a per-ledger lease, validate the v2 snapshot and event hash chain, and
reconcile live branch, worktree, PR, head, checks, and issue identity before
resuming.

`release_handoffs` does not mean “Changeset required.” It contains only issues
whose core task is release or publishing. Those issues are never dispatched to
implementation and terminally park at `blocked-maintainer-decision`. When
multiple handoffs exist, already parked items may coexist with untouched queued
handoffs while the root status remains `running`.

## Attempt loop

```text
queued -> running -> in_review
in_review + triad PASS -> observed squash merge -> merged
merged -> observed cleanup -> root ff-only sync -> done
in_review + fixable block -> running on same PR -> new head -> in_review
in_review + human/non-fixable -> explicit terminal blocker
```

Every fix must preserve issue, branch, worktree, and PR identity and produce a
new head. Re-run every reviewer on that head; never reuse prior PASS evidence.

No-progress, identical blocker repetition, total attempts, elapsed time,
malformed child output, stale approval, and ledger conflicts stop fail-closed.

## Side effects

Record each mutation as:

```text
INTENT event -> action -> live OBSERVED event -> candidate validation
-> atomic snapshot replacement
```

Issue/PR creation, push, merge, cleanup, root sync, cutover, and rollback each
require a machine-readable target/head-bound receipt. Resume must load the
snapshot and prove the prior event stream is an exact immutable prefix before
appending. Local publishing is forbidden.

## Production live observations

The lead executes these checks directly; child output and fixture JSON are not
live evidence:

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

Before merge, the lead verifies the triad against `headRefOid`. After merge, it
requires `state: MERGED`, a non-null merge commit, and the linked issue
`state: CLOSED`. Cleanup receipts require the worktree and local/remote branch
queries to prove absence. Root-sync receipts require a clean primary checkout,
successful `pull --ff-only`, and equal local/remote base-branch SHAs.

`scripts/fixtures/run-replay.mjs --fixture-only` is a deterministic transition
exerciser and never grants or observes production side-effect authority.
