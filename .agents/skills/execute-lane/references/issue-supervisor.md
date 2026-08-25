# Native issue supervisor

One single-node DAG owns one issue from initial implementation through merge
and cleanup. Parent-owned dispatch may start independent eligible issues
concurrently. A dependent node is not created until every canonical dependency
is already shared `done`; native DAG ordering is never used as success
evidence.

## Role separation

The supervisor orchestrates but does not implement or review:

- one implementer child edits, tests, and commits in the assigned worktree;
- contract, code, and verification reviewers run as three independent,
  read-only children against one captured local head;
- the supervisor aggregates results, controls retries, and performs only the
  issue-bound Git/GitHub actions granted by `authority_scope`;
- the parent execute-lane lead alone mutates the shared lane ledger and performs
  root synchronization.

## Local review loop

```text
implementing -> local-review
local-review + BLOCK -> implementing -> new head -> local-review
local-review + NEEDS-HUMAN-CHECK -> terminal blocker
local-review + all PASS and no PR -> ready-for-pr
local-review + all PASS and existing PR -> ready-for-push
```

Every implementation or fix must produce a new commit head. Capture exactly one
contract, code, and verification result against that head. A head change
invalidates the complete triad. `ready-for-pr` and `ready-for-push` authorize
only the next issue-bound remote observation; neither is a merge verdict.

New lanes use adaptive retry. The supervisor records attempt count and elapsed
time as telemetry and keeps every `fix_back_eligible: true` blocker in this
loop until success. Repeated blocker signatures require a materially different
implementation strategy, not numeric-budget terminalization. A
`fix_back_eligible: false` blocker parks at `needs-human-check-terminal`.
Existing persisted lanes with an approved bounded policy retain those limits.

## PR and CI loop

At `ready-for-pr`, push the reviewed head and create one PR. At
`ready-for-push`, push the new reviewed head to the existing PR branch. Observe
that the remote branch, PR `headRefOid`, and reviewed local head are identical
before entering `ci-pending`.

Classify required CI on that exact head:

- `pass` -> `merge-ready`;
- `fixable-failure` -> `ci-fix-back`, then implementation, a new head, the full
  local triad, push, and CI again;
- `external-failure` -> `needs-human-check-terminal` without speculative code
  edits.

Green unrelated jobs do not satisfy required CI. Pending, stale, unavailable,
infrastructure, policy, or approval failures are not implementation defects.

## Merge and cleanup

`merge-ready` requires the local reviewed head, remote branch head, PR head, and
CI head to remain identical. Under lane merge authority, perform a squash merge
and observe the PR as `MERGED`, a non-null merge commit, and the linked issue as
`CLOSED`.

Then remove the worktree, local branch, and remote branch under cleanup
authority. Record `done` only after all required absence checks succeed.
Incomplete cleanup is a terminal blocker and does not silently release a
dependent issue.

## Recovery

Before any remote action, re-read live Git and GitHub identity. On task restart,
resume from the issue state and live observations rather than repeating the
last claimed action. The node returns typed transition evidence and receipts;
the parent validates them before updating the shared lane ledger.

Before creating a child, branch, or worktree, re-read the shared snapshot and
require the issue to remain its lane's queued cursor with every dependency
present in `completed_issues` and `issue_progress.status === 'done'`. If that
precondition changed after dispatch, return a ledger-conflict terminal without
performing a mutation.

## Stop

Stop with `done` only after observed merge and cleanup. Otherwise stop with one
explicit human, policy, external, cleanup, child-contract, or ledger blocker.
Never report success merely because the DAG node or a child task returned.
