# Native execute-lane workflow

## Persisted truth

- Snapshot: `.omo/lanes/<lane-id>.json`
- Events: `.omo/lane-runs/<lane-id>/events.jsonl`

Acquire a per-ledger lease, validate the v2 snapshot and event hash chain, and
reconcile live branch, worktree, PR, head, checks, and issue identity before
resuming.

## Attempt loop

```text
queued -> implementing -> pr-ready -> reviewing
reviewing + merge -> merge gate -> merged -> cleanup -> done
reviewing + fixable block -> fixing same PR -> new head -> reviewing
reviewing + human/non-fixable -> explicit terminal blocker
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
require a target/head-bound receipt. Local publishing is forbidden.
