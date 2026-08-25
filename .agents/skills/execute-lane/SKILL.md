---
name: execute-lane
description: Drain one canonical Fluo lane through implementation, same-head review, bounded fix-back, merge authority, cleanup, and resumable evidence.
---

# Execute lane

Consume only a strict canonical lane v2 created by `$create-lane`. Do not
rediscover issues, regroup scope, or infer missing persisted fields.

The parent lead is the only shared lane snapshot/event/receipt/lease writer.
It compiles the validated lane snapshot into one native DAG node per issue.
Each issue node is a supervisor for one isolated issue lifecycle and may use
only the Git/GitHub authority explicitly granted by the lane. Implementers and
reviewers remain nested, separately delegated roles.

Read `references/workflow.md` and `references/issue-supervisor.md` before
execution. Compile the graph with `scripts/compile-dag.mjs`, bind the native
run through `scripts/dag-binding.mjs`, and persist the binding at
`.omo/lane-runs/<lane-id>/dag-binding.json`. Goal, todo, and DAG state remain
projections of the persisted lane state and live observations.

Production execution never uses `scripts/fixtures/run-replay.mjs`. The lead
performs or observes each authorized Git/GitHub action, reads fresh raw output,
then writes the target-bound receipt and transition. Synthetic observation JSON
is fixture evidence only.

Stop only when every lane is `done` or has an explicit terminal blocker and
cleanup/root-sync state is terminal. Before the first push, every issue must
reach `ready-for-pr` through one same-head local contract/code/verification
triad. A fixable CI failure returns that issue to implementation and invalidates
all prior local review evidence. CI PASS on the exact reviewed PR head produces
`merge-ready`; only an issue supervisor's fresh lead-authorized merge
observation may create a merge receipt.
