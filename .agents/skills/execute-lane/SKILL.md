---
name: execute-lane
description: Drain one canonical Fluo lane through implementation, same-head review, bounded fix-back, merge authority, cleanup, and resumable evidence.
---

# Execute lane

Consume only a strict canonical lane v2 created by `$create-lane`. Do not
rediscover issues, regroup scope, or infer missing persisted fields.

The lead is the only snapshot/event writer. Child tasks return typed
implementation or review results and never mutate the ledger. Goal, todo, and
DAG state are projections of the persisted snapshot and event stream.

Read `references/workflow.md` before execution. Use `$issue-to-pr` for new PR
and same-PR fix-back contracts and `$pr-to-merge` for the read-only same-head
review triad.

Stop only when every lane is `done` or has an explicit terminal blocker and
cleanup/root-sync state is terminal. An explicit `merge` verdict is necessary
but does not itself grant merge authority.
