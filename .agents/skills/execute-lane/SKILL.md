---
name: execute-lane
description: Drain one canonical Fluo lane through implementation, same-head review, adaptive fix-back, merge
authority, cleanup, and resumable evidence.
---

# Execute lane

Consume only a strict canonical lane v2 created by `$create-lane`. Do not rediscover issues, regroup scope, or infer
missing persisted fields. Require the exact `.omo/lanes/<lane-id>.json` path, revalidate its source artifact and all
three approval receipts, and bind every resumed snapshot to the canonical ledger's immutable plan before compiling or
mutating anything.

The parent lead is the only shared lane snapshot/event/receipt/lease writer. It compiles exactly one native DAG from
the immutable lane ledger. Every confirmed issue is one supervisor node, explicit `dependency_graph` edges map to
native `dependsOn`, and queue predecessors add the ordering needed to preserve each approved lane queue. Independent
issue nodes run concurrently. Each supervisor owns one isolated issue lifecycle and may use only the Git/GitHub
authority explicitly granted by the lane. Implementers and reviewers remain nested, separately delegated roles.

Read `references/workflow.md` and `references/issue-supervisor.md` before execution. Compile the ledger once with
`compileLaneSupervisorDag()`. Use
`scripts/lane-dispatch.mjs` to persist one lane-bound dispatch intent before
start, then attach the observed run through `attachLaneSupervisorRun()` at
`.omo/lane-runs/<lane-id>/dag-binding.json`. Attachment loads the canonical
native run record from `.omo/senpi-task/dag/runs/<run-id>.json`, authenticates it against the canonical native key
record, and requires its submitted definition to match the intent-bound digest. An exact existing binding resumes from
that native definition rather than recompiling current workflow source. A digestless legacy intent without its
immutable binding requires a successor lane. An intent/binding crash window fails closed and never authorizes a
duplicate start. Goal, todo, and DAG state remain projections of the persisted lane state and live observations.

The dispatch interface accepts `repository_root`, never a caller-selected runtime root, and derives `.omo/lane-runs`
internally. Every issue supervisor must pass the event-driven startup gate before mutation:

```text
node .agents/skills/execute-lane/scripts/await-lane-dispatch.mjs \
  --root . --ledger .omo/lanes/<lane-id>.json
```

After the native DAG settles, run `lane-settlement-audit.mjs`. Native node completion means only that a child
returned. It is never lane success without canonical terminal issue stores and parent import.

Production execution never uses `scripts/fixtures/run-replay.mjs`. The lead performs or observes each authorized
Git/GitHub action, reads fresh raw output, then writes the target-bound receipt and transition. Synthetic observation
JSON is fixture evidence only.

Stop only when every lane is `done` or has an explicit terminal blocker and cleanup/root-sync state is terminal.
Before the first implementation, every issue must persist one immutable review preflight derived from either the selected issue
or an explicitly approved suggested addition plus a fresh trusted-lead GitHub issue contract. Each row carries the exact live acceptance text and digest; row IDs and `acceptance_row_ids` equal the complete canonical acceptance set. Every revision/content-bound core or additional
docs/RFC/security source is row-covered. Then reach `ready-for-pr` through one complete same-head local
contract/code/verification batch. All three reviewers must settle before remediation begins,
close every preflight row, and bind each blocker to its approved source and invariant. Two blocked heads require a
fresh implementer generation. Contract/code tasks use only read/search/LSP/history tools. Verification is the only local-CI writer and makes exactly one shell call: the issue/head/task-bound `canonical-verification.mjs ... -- pnpm verify`. The wrapper installs and runs from a clean disposable exact-head worktree, resolves the canonical host pnpm store before HOME/XDG isolation, mounts that store read-only, and binds the store path plus lockfile/tree/input integrity into the receipt. The OS backend limits writes to disposable/runtime temp and denies candidate signals to outside processes. It reaps every observed or process-group descendant; an instant escaped descendant may outlive observation but inherits OS confinement from canonical authority state and supervisor/reviewer processes, and disposable/runtime cleanup makes it harmless. Canonical Senpi JSONL tool events and the wrapper receipt are digest-bound into reviewer evidence. A fixable CI failure returns that issue to implementation and invalidates all prior local review evidence. A
post-PR conflict uses the persisted typed conflict gate. A distinct real conflict-scoped `fluo-issue-implementer` produces the commit and machine final output while the supervisor remains non-editing; task reuse is forbidden. Mechanical inheritance requires machine-proven old-base/reviewed versus upstream/resolved canonical patch equivalence and no upstream overlap. Canonical changed/conflicting paths and diff shapes set the minimum rerun axes; reviewers may add but never omit axes. Ambiguous/cross-cutting impact reruns all axes before exact-head CI. Every trusted boundary revalidates the registered Git worktree, branch, commit existence, and
live HEAD. Conflict content and pairwise diff digests are recomputed from canonical Git objects rather than trusted
from reviewer claims. CI PASS on the exact reviewed PR head produces `merge-ready`; only an issue supervisor's fresh
lead-authorized merge observation may create a merge receipt.

Native task completion is a settled claim only, never lane or dependency success. Before any mutation, a dependent
supervisor validates each predecessor's persisted issue-store terminal evidence and proceeds only when every
predecessor is canonical `done`. Missing, malformed, or blocked predecessor evidence produces a typed dependency
blocker without creating issue artifacts. After the DAG settles, the parent audits all canonical issue stores, then
imports terminal evidence in topological order into the shared lane ledger.
`needs-human-check`, policy, external, cleanup,
malformed-output, and ledger terminal states never release mutation.
