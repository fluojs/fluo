# Native issue supervisor

One lane DAG contains one supervisor node per approved issue. Each node owns
its issue from initial implementation through merge and cleanup. Independent
nodes run concurrently; explicit dependencies and queue predecessors are
native `dependsOn` edges. Native ordering is never treated as success evidence.

## Role separation

The supervisor orchestrates but does not implement or review:

- one implementer child edits, tests, and commits in the assigned worktree;
- contract, code, and verification reviewers run as three independent,
  read-only children against one captured local head;
- the supervisor aggregates results, controls retries, and performs only the
  issue-bound Git/GitHub actions granted by `authority_scope`;
- the parent execute-lane lead alone mutates the shared lane ledger and performs
  root synchronization.

The implementer alone uses the `fluo-issue-implementer` subagent configured in
`.omo/omo.jsonc` for `openai-codex/gpt-5.6-terra` with `high` reasoning. The
supervisor must include the complete `issue-to-pr/references/implementer.md`
contract in that child prompt without a category or model override. After the
child terminates, `scripts/implementer-runtime.mjs` must verify the persisted
task metadata and actual child session both prove Terra high execution. Missing
or mismatched evidence is a terminal child-contract blocker. Reviewer routing
is unchanged and must never reuse the implementer route.

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

Immediately after entering `ci-pending`, and on every fresh PR observation
while checks are pending, query `mergeable` and `mergeStateStatus`. A
`CONFLICTING` or `DIRTY` result is a fixable PR conflict: persist a head-bound
`pr-conflict` receipt that proves the PR remains `OPEN`, then enter
`ci-fix-back` without waiting for CI. Conflict resolution must produce a new
head and rerun the complete local triad.

When a successor lane reconciles an existing canonical branch, worktree, and
OPEN PR, reuse those identities instead of creating duplicates. Rerun the full
local triad against the observed head, then persist a `pr-adopt` receipt binding
the local, remote, and PR heads before entering `ci-pending`. A closed PR, stale
head, mismatched issue branch, or noncanonical worktree fails closed.

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

Before creating a child, branch, worktree, or PR, load every compiled
predecessor's isolated issue store and validate it through
`supervisor-terminal.mjs`. Proceed only when every terminal is canonical
`done`, including observed merge, CLOSED issue, and cleanup. Missing, malformed,
or blocked predecessor evidence returns a typed dependency blocker without
performing a mutation. The shared snapshot may still name an earlier queue
cursor while the lane DAG runs because the parent imports settled terminals in
topological order after the DAG settles.

Before that dependency gate, run the event-driven canonical dispatch gate:

```text
node .agents/skills/execute-lane/scripts/await-lane-dispatch.mjs \
  --root . --ledger .omo/lanes/<lane-id>.json
```

Do not treat the short start/attach interval as a terminal ledger conflict.
Wait for the exact canonical binding. A timeout or mismatched immutable
binding remains fail-closed. The gate authenticates the binding against the
native run's persisted submitted definition and does not recompile current
workflow source for an already attached run.

## Stop

Stop with `done` only after observed merge and cleanup. Otherwise stop with one
explicit human, policy, external, cleanup, child-contract, or ledger blocker.
Never report success merely because the DAG node or a child task returned.
