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
