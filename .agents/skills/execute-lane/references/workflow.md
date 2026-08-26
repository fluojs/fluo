# Native execute-lane workflow

## Persisted truth

- Ready input: `.omo/lanes/<lane-id>.json`
- Runtime snapshot: `.omo/lane-runs/<lane-id>/snapshot.json`
- Events: `.omo/lane-runs/<lane-id>/events.jsonl`
- Receipts: `.omo/lane-runs/<lane-id>/receipts.json`
- Lease: `.omo/lane-runs/<lane-id>/lease.json`
- Lane DAG binding: `.omo/lane-runs/<lane-id>/dag-binding.json`
- Legacy issue bindings:
  `.omo/lane-runs/<lane-id>/dag-bindings/issue-<number>.json`
- Issue runtime: `.omo/lane-runs/<lane-id>/issues/<issue-number>/`

Acquire a per-ledger lease, validate the v2 snapshot and event hash chain, and
reconcile live branch, worktree, PR, head, checks, and issue identity before
resuming.

Before acquiring the lease, require the exact canonical
`.omo/lanes/<lane-id>.json` path with a matching filename and reject symlinked
or repository-escaping evidence. Re-read the source search artifact and the
`confirmed-issues`, `suggested-additions`, and `lane-plan` approval receipts.
Recompute every approval binding, require the artifact ID/SHA and approved plan
to reproduce the ledger's immutable fields, and reject a resumed snapshot when
its source, authority, retry policy, issue set, lane queues, dependencies, or
release handoffs differ from that canonical plan.

`release_handoffs` does not mean “Changeset required.” It contains only issues
whose core task is release or publishing. Those issues are never dispatched to
implementation and terminally park at `blocked-maintainer-decision`. When
multiple handoffs exist, already parked items may coexist with untouched queued
handoffs while the root status remains `running`.

Before accepting any non-empty handoff set, load the consumed `lane-plan`
approval receipt and require its issue numbers to match the ledger exactly.
Each receipt attestation must retain the approved issue evidence digest,
`decision: "release-or-publish-is-core"`, and `changeset_only: false`.
Recompute the receipt binding and require it to equal the independent
`lane_plan_approval_sha256` stored in the ready ledger.

## Parent-owned lane DAG dispatch

Production compiles exactly one native DAG from one immutable lane ledger.
Every confirmed issue becomes one supervisor node. Explicit
`dependency_graph` edges map to `dependsOn`, and each issue after the first in a
lane queue also depends on its direct queue predecessor. The combined graph
must be acyclic. The parent:

1. reconciles the shared snapshot, existing lane binding, issue stores, and
   live identities;
2. compiles the ledger through `compileLaneSupervisorDag()`;
3. calls `reconcileLaneSupervisorDispatch()`;
4. persists the returned `lane.dag.dispatch.intent` candidate;
5. starts the complete native DAG once;
6. immediately attaches the observed run with
   `attachLaneSupervisorRun()`;
7. authenticates the run key and submitted definition from
   `.omo/senpi-task/dag/runs/<run-id>.json`;
8. persists its immutable v3 binding at `dag-binding.json`;
9. requires every supervisor to pass `await-lane-dispatch.mjs` before
   mutation.

The dispatch interface accepts the repository root and derives the only valid
runtime root, `.omo/lane-runs`, internally. Callers cannot select a binding
directory. The startup gate subscribes to the canonical binding path before
rechecking it, so a fast attach cannot be missed and a delayed attach does not
become a false terminal blocker.

An attached run resumes from the authenticated native run definition, not a
fresh `compile-dag.mjs` result. This keeps a long-lived exact run attachable
when workflow source changes later. A legacy dispatch intent that has no
definition digest remains compatible only when its existing binding matches
the native run record. If that binding is missing, recovery requires a
successor lane; never synthesize a new binding from current source.

Independent nodes run concurrently. Native `dependsOn` is an ordering signal,
not semantic success. Before mutation, every dependent supervisor loads and
validates each predecessor's isolated issue store through
`supervisor-terminal.mjs`. Only canonical `done` evidence preserving merge,
CLOSED issue, and cleanup authorizes mutation. Merge alone, a CLOSED
observation, native task completion, missing or malformed evidence, or any
terminal blocker does not release mutation.

After the lane DAG settles, the parent first runs
`scripts/lane-settlement-audit.mjs`. A native `completed` node is only a
settled claim. Missing or nonterminal canonical issue stores keep the lane
incomplete. The parent then validates and imports issue terminals in
topological order. A blocked dependency terminalizes unreachable dependents
only after fresh absence observations prove no branch, worktree, child, or PR
was created for them. Those observations are recorded in the
`dependency.blocked` event. An existing dispatch intent without an exact lane
binding is an ambiguous crash window and
`reconcileLaneSupervisorDispatch()` fails closed. An existing exact binding
returns only `attach`; it never authorizes a duplicate start.

Legacy v1 lane-wide bindings and v2 per-issue bindings remain immutable evidence
only. Do not overwrite, amend, or resume them as the production scheduler.
Reconcile their issue stores and live state, then require a new approved lane
identity for unfinished work. The successor may reuse a reconciled canonical
issue branch, worktree, and OPEN PR. It must rerun the same-head local triad and
persist a fresh `pr-adopt` receipt under the successor lane identity before
observing CI.

Each dispatched node initialises `scripts/issue-supervisor-store.mjs` under its
issue runtime directory. Every local review, remote observation, receipt, and
status transition is transactionally persisted there. The parent imports only
a validated terminal supervisor state through `scripts/supervisor-terminal.mjs`.

## Issue supervisor loop

```text
queued -> implementing -> local-review
local-review + fixable BLOCK -> implementing -> new head -> local-review
local-review + all PASS -> ready-for-pr
ready-for-pr -> observed push and PR creation -> ci-pending
ci-pending + PR CONFLICTING/DIRTY -> ci-fix-back -> new head -> local-review
ci-pending + fixable failure -> ci-fix-back -> new head -> local-review
local-review + all PASS and existing PR -> ready-for-push
ready-for-push -> observed push -> ci-pending
ci-pending + PASS -> merge-ready
merge-ready -> observed squash merge -> merged
merged -> observed cleanup -> done
human, external CI, policy, or malformed output
  -> explicit terminal blocker
```

Before PR creation, the local triad consists of exactly one contract, code, and
verification result bound to the local commit head. Its successful aggregate is
`ready-for-pr`, never `merge`. Every fix preserves issue, branch, and worktree;
after PR creation it also preserves PR identity. Every fix produces a new head
and reruns the complete local triad.

CI must bind the same reviewed PR head. A code or test failure may enter
`ci-fix-back`. Infrastructure, missing, stale, policy, approval, or other
external failures enter human review without code mutation. A CI PASS on the
same reviewed head produces `merge-ready`; a fresh issue-supervisor observation
then performs and proves the merge.

New lanes use adaptive retry: attempt count and elapsed time are telemetry, not
terminal limits. Every fixable blocker returns through implementation, a new
head, and the complete local triad until success. Repeated blocker signatures
require a materially different remediation strategy, but repetition alone does
not terminalize the supervisor. Existing ledgers with an approved bounded
policy retain their original count and wall-clock terminal behavior.

A claimed fix that produces no new head is malformed child output rather than
progress. Non-fixable review blockers, external CI, stale approval, malformed
child output, and ledger conflicts stop fail-closed.

## Side effects

Record each mutation as:

```text
INTENT event -> action -> live OBSERVED event -> candidate validation
-> atomic snapshot replacement
```

Issue supervisors may perform push, PR creation/update, squash merge, and
cleanup only when those operations are granted by the immutable lane authority.
Each operation requires a machine-readable target/head-bound receipt and fresh
live observation. The parent lead validates returned evidence and is the only
shared ledger writer. Root sync, cutover, rollback, and publication remain
parent-owned. Resume must prove the prior event stream is an exact immutable
prefix before appending. Local publishing is forbidden.

## Production live observations

The issue supervisor executes issue-bound checks directly; the parent lead
executes root-state checks. Nested child output and fixture JSON are not live
evidence:

```bash
gh pr view <pr> --json number,url,state,headRefName,headRefOid,mergeable,mergeStateStatus,mergeCommit,mergedAt
gh issue view <issue> --json number,state,url
git worktree list --porcelain
git show-ref --verify refs/heads/<branch>
git ls-remote --exit-code --heads origin <branch>
git status --porcelain
git pull --ff-only origin <base-branch>
git rev-parse HEAD
git rev-parse origin/<base-branch>
```

Before the single DAG dispatch, the parent requires an exact ready lane
identity. Before first mutation, each issue supervisor requires its immutable
node identity and canonical `done` terminal evidence for every compiled
predecessor. The shared snapshot need not yet expose that issue as the queue
cursor because the parent imports all settled terminals later in topological
order. Before first push and every update, the issue supervisor verifies the
complete local triad against the commit head. Before merge, it verifies the reviewed
head, remote branch, `headRefOid`, and CI head are identical. After merge, it
requires `state: MERGED`, a non-null merge commit, and the linked issue
`state: CLOSED`. Cleanup receipts require the worktree and local/remote branch
queries to prove absence. The parent performs root sync only after every lane is
done or explicitly terminal; its receipt requires a clean primary checkout,
successful `pull --ff-only`, and equal local/remote base-branch SHAs.

`scripts/fixtures/run-replay.mjs --fixture-only` is a deterministic transition
exerciser and never grants or observes production side-effect authority.
