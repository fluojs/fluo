# Issue lifecycle state

The `issue-supervisor-*` module names are retained as the mature issue-local
state machine and evidence store. There is no `fluo-issue-supervisor` DAG node
in execute-lane v3.

## Ownership

The trusted parent coordinator is the issue state `parent_session_id`. It alone
persists issue transitions and issue-DAG control state. Direct DAG workers
return claims; they never write trusted state or orchestrate another worker.

Every accepted child binds:

- lane and issue;
- issue DAG key, run ID, node ID, and owner fingerprint;
- coordinator parent session;
- branch, worktree, input head, and generation;
- preflight and blocker-ledger digests;
- native task attachment event;
- canonical task/session evidence and machine final response.

## Preflight

Before implementation, resolve canonical preflight authority from the exact
lane ledger, selected issue approval, lane-plan approval, search artifact, and
fresh trusted `gh issue view` observation.

Compile a starting-head-bound `fluo-issue-preflight` node. It is source-read-only
and must return all exact live Acceptance Criteria as immutable rows with
source revisions/content digests and positive, negative, boundary,
complexity, memory, atomicity, and mutation-boundary coverage.

The parent recomputes authority and persists `preflight-completed`. A child
claim does not make the artifact authoritative.

## Implementation

The direct `fluo-issue-implementer` node owns one issue worktree and one
generation. It reads the complete implementer contract and may run focused
test-first and changed-file checks. It does not run repository-wide canonical
verification, push, mutate a PR, merge, cleanup, or dispatch agents.

The parent verifies:

- the native node/task binding and actual Terra-high session;
- exact terminal dispatch and machine response;
- immutable preflight and blocker-ledger digests;
- `new_head !== current_head`;
- current live worktree HEAD equals the claimed new head.

Only then may `implementation-completed` or `fix-completed` move the issue to
`local-review`.

## Local review

Contract, code, and verification are three independent direct DAG nodes on one
exact head.

- Contract and code are source-read-only.
- Verification uses source-read-only tools plus exactly one successful
  `canonical-verification.mjs` wrapper call.
- Every node closes every preflight row and reports all currently discoverable
  blockers.

The parent verifies canonical task owner, session tool events, final response,
row coverage, and same-head identity before persisting the review batch.

Ordinary source mutation invalidates every previous ordinary PASS. A new head
requires a complete fresh triad. The only PASS inheritance path is the typed
conflict gate backed by canonical Git equivalence and path-overlap evidence.

## Adaptive fix-back

Persist every review/CI/conflict blocker into the cumulative blocker ledger.
Each fix is a new direct implementation node. Never revive or reuse a previous
task ID.

After two blocked heads since the last implementer generation, increment the
generation and pass the complete cumulative ledger, current unresolved subset,
and current diff. Retry counters remain telemetry under adaptive policy; they
are not arbitrary terminal limits. Malformed child provenance is immediately
terminal.

## PR, CI, conflict, merge, and cleanup

Operator nodes perform exactly one issue-bound remote action. The parent
reobserves and persists existing remote transition receipts.

Refresh PR mergeability before and while observing CI. A fresh OPEN
`CONFLICTING` or `DIRTY` PR enters the three-wave conflict lifecycle:

```text
conflict implementation
-> conflict gate
-> required review axes
```

The conflict implementer returns the previously unknown resolved head. The
gate computes affected axes from canonical Git. The parent accepts the
complete conflict transition only after the resolved worktree head, gate, and
required reviewer receipts all verify.

Merge remains exact-head and squash-only. `done` requires observed merge,
closed issue, and complete cleanup. Cleanup failure is terminal and never
releases dependents.

## Recovery and stop

The issue-DAG event journal and issue store cross-link every accepted phase.
After a crash, observe native, task, Git, and GitHub state before repeating any
effect. Reuse the same run and completed nodes.

Stop the issue only when:

- canonical issue state is `done` after cleanup; or
- one explicit terminal blocker is persisted;

and the issue-DAG control bundle is terminalized with the exact issue terminal
event hash. Native `completed` alone is never a stop condition.
