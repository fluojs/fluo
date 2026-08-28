---
name: execute-lane
description: Drain one canonical Fluo lane through independent issue DAGs, exact-head review, adaptive fix-back, merge, cleanup, and resumable evidence.
---

# Execute lane

Consume only a strict canonical lane v2 created by `$create-lane`. Require the
exact `.omo/lanes/<lane-id>.json` path and revalidate its source artifact,
selected-issue approval, lane-plan approval, and immutable issue collection.
Do not rediscover, regroup, or silently upgrade an in-flight lane.

Read `references/workflow.md` and `references/issue-supervisor.md` before
execution.

## Architecture

The lane is a parent-owned coordinator, not a native DAG. Each admitted issue
owns one durable lifecycle key:

```text
fluo:lane:<lane-id>:issue-<issue-number>:lifecycle:v3
```

Native DAG runs are session-bound execution segments, not durable workflow
identity. One coordinator session owns one active segment. A resumed
coordinator starts a successor segment for only the pending phase and records
the prior run in `predecessor_runs`; it never adopts the prior session's run.
Lifecycle phases are direct DAG nodes. A node never calls `task`, `dag`, team,
or another orchestration surface.
Direct workers use project-local `fluo-*` agents whose task, DAG, and team
dispatch tools are disabled. The parent waits for each native wave to settle
and authenticates exactly one machine final response before advancing.
Detached or `persisted_only` child records are not progress.

The parent advances one issue only through:

```text
persist intent
-> native effect
-> authenticate native journal/task evidence
-> verify semantic result and live Git/GitHub state
-> persist issue transition
-> persist phase settlement
-> append the next authorized wave
```

`dependsOn` is ordering only. No child output is propagated into a later
prompt. The parent verifies and persists each result, then compiles the next
wave from canonical state.

## Admission

Use `lane-coordinator.mjs` or:

```text
node .agents/skills/execute-lane/scripts/lane-coordinator-cli.mjs plan \
  --root . --ledger .omo/lanes/<lane-id>.json --max-active 2
```

An issue is admitted only when every explicit dependency and approved queue
predecessor has imported canonical `done` evidence. Native completion, merge,
or a child claim never releases a dependent. A blocked predecessor
terminalizes untouched descendants only with fresh absence evidence proving no
issue DAG, task, branch, worktree, PR, or side effect exists.

Persist one issue-DAG dispatch or rollover intent before native `start`.
Authenticate the native key record, run checkpoint, coordinator session,
generation, definition fingerprint, and event journal before attaching the
immutable `run_id`. Never adopt a run from another coordinator session. When
ownership changes, compile only the pending phase, append
`run-rollover-intent`, and start a new session-local run under the same issue
lifecycle key.

## Phase-gated amendments

Compile the starting-head-bound preflight node with
`compileIssueLifecycleDag()`. Within one coordinator session, append only the
next wave with `amendIssueLifecycleDag()`. Across coordinator sessions, compile
only the pending wave with `compileIssueLifecycleSegment()` and preserve
completed phase receipts in the issue store rather than replaying historical
nodes.

The cumulative topology is:

```text
preflight
-> implementation/fix
-> contract + code + verification review
-> PR create/adopt/update
-> CI observation
-> merge
-> cleanup
```

Fix-back appends a new implementation generation and a new exact-head review
triad. Conflict handling is three separate amendments because the resolved
head is unknown in advance:

```text
conflict implementation
-> conflict gate
-> required conflict review axes
```

Every node ID contains the complete 40-character head and generation or
observation identity. Completed nodes are immutable history. Never rename or
reuse them. Reject an amendment that changes existing nodes, invalidates a
completed node, mismatches `dag.definition.amended`, or exceeds 64 nodes.

## Direct node roles

- `fluo-issue-preflight`: source-read-only canonical acceptance compilation.
- `fluo-issue-implementer`: one issue-worktree implementation or conflict
  resolution generation; focused test-first checks only.
- `fluo-contract-reviewer`, `fluo-code-reviewer`,
  `fluo-verification-reviewer`: independent exact-head review. Contract/code
  are source-read-only. Verification reads and authenticates exactly one
  immutable parent-owned canonical verification receipt.
- `fluo-issue-operator`: exactly one issue-bound PR, CI, merge, cleanup, or
  release-handoff operation followed by fresh observation.

All project agents deny orchestration tools and run at task depth 1. Runtime
verification must still reject any actual orchestration call. Configuration is
policy; canonical task owner, native attachment events, task/session logs, and
machine final responses are evidence.

## Evidence and recovery

`issue-dag-store.mjs` persists a hash-chained issue-local control bundle:

```text
dispatch-intent
-> phase-running
-> native-completed-unverified
-> phase-settled
-> amend-intent
-> phase-running
-> terminal
```

Native generation starts at 1 and increments once per amendment. Local
`definition_generation` starts at 0. `implementer_generation` is the separate
fix-back generation. `run_epoch` advances only when coordinator ownership
changes; `predecessor_runs` preserves immutable prior run bindings.

Recovery is observe-before-effect:

- intent without a run: discover the canonical key record before `start`;
- run without local attachment: authenticate and attach;
- run owned by another coordinator session: persist `run-rollover-intent` and
  start a successor segment containing only the pending phase;
- amendment intent with native base: amend once;
- native target already applied: authenticate the exact amendment event and
  attach it without re-amending;
- native completion without issue transition: verify task/runtime/live state
  and import once;
- malformed retryable preflight output: append a fresh
  `preflight-g<N>-h<head>` node; never revive the completed node;
- issue transition without phase settlement: match its accepted receipt and
  event hash, then backfill settlement;
- uncertain PR/merge/cleanup: observe live state before any repeat mutation.

A malformed/lost implementer that mutated the head remains a terminal child
contract failure. Do not reset, revive, steer, or silently adopt the head.

## Review, remote lifecycle, and settlement

Keep the existing review-preflight, implementer/runtime, reviewer/runtime,
conflict, remote receipt, canonical verification, and trusted Git/GitHub
contracts. The parent supplies direct DAG owner evidence to every runtime
verifier and imports only verified machine results.

Native `completed` means only that a child returned. It is never issue success.
After canonical cleanup or a typed blocker, terminalize the issue-DAG bundle
with the exact issue terminal event hash. `lane-settlement-audit.mjs` accepts a
terminal claim only when the issue store and issue-DAG terminal projection
match. Dependency release still requires canonical issue `done`.

The parent serializes merges and root-main synchronization. Publishing remains
GitHub Actions-only and Changesets-only. Release handoffs park as
`blocked-maintainer-decision`.

## Stop

Stop when every confirmed issue is independently canonical `done` or an
explicit terminal blocker, every admitted issue DAG is terminal and
event-bound, untouched blocked descendants have absence evidence, the lane
settlement audit is terminal-claims-ready, and root `main` is synchronized
according to lane authority.
