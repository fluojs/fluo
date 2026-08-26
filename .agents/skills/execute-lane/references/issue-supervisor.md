# Native issue supervisor

One lane DAG contains one supervisor node per approved issue. Each node owns its issue from initial implementation
through merge and cleanup. Independent nodes run concurrently; explicit dependencies and queue predecessors are native
`dependsOn` edges. Native ordering is never treated as success evidence.

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
supervisor must include the complete `issue-to-pr/references/implementer.md` contract in that child prompt without a
category or model override. After the child terminates, `scripts/implementer-runtime.mjs` must verify the persisted
task metadata and actual child session both prove Terra high execution. Missing or mismatched evidence is a terminal
child-contract blocker. Reviewer routing is unchanged and must never reuse the implementer route.

## Local review loop

```text
preflight -> implementing -> local-review
local-review + BLOCK -> implementing -> new head -> local-review
local-review + NEEDS-HUMAN-CHECK -> terminal blocker
local-review + all PASS and no PR -> ready-for-pr
local-review + all PASS and existing PR -> ready-for-push
```

Version 2 issue stores start at `preflight` under `canonicalLaneRuntimeRoot(repository_root)`; version 1 is rejected.
The store derives identity and `resolveCanonicalPreflightAuthority()` from the canonical ledger, selected-issue or
approved-suggested-addition receipt, lane-plan approval, search artifact, and fresh trusted-lead GitHub issue snapshot.
The snapshot binds repository/origin, issue identity and updated content, acceptance IDs/content digests, and its
observation receipt. Before implementation, persist one immutable matrix whose row IDs and `acceptance_row_ids`
exactly equal all canonical acceptance IDs. Cover every revision/content-bound core source; extra docs/RFC/security
sources require canonical Git revisions/content digests and row coverage. Pass the matrix unchanged to every child.

Every implementation or fix creates a new head and invalidates the prior triad. Spawn contract, code, and verification
in one batch, await all three, and bind complete row coverage plus each blocker to source, invariant, reproduction, and
blocking category. Contract/code use only known read/search/LSP/history tools and never shell or mutation. Verification alone writes local-CI artifacts, using those read-only tools plus exactly one successful shell event for the fully bound `canonical-verification.mjs ... --head <head> --preflight <sha256> --task <task-id> -- pnpm verify` invocation; direct CI shells and unrelated mutations are rejected. The reviewer verifier digests canonical Senpi JSONL tool events and binds the wrapper command/result receipt to that session digest. Implementers may run focused test-first checks, never the full local-CI gate.

Use `implementerTaskName()` and exact `implementerPromptSentinel()` evidence from the canonical Senpi task store; task
IDs are single-use. After two blocked heads, rotate to a fresh Terra-high task with the full preflight, cumulative
blocker ledger, current diff, and root-cause audit. Adaptive lanes retain fixable blockers until success; non-fixable
blockers park, while persisted bounded policies retain their approved limits.

## PR and CI loop

At `ready-for-pr`, push the reviewed head and create one PR. At
`ready-for-push`, push the new reviewed head to the existing PR branch. Observe
that the remote branch, PR `headRefOid`, and reviewed local head are identical before entering `ci-pending`.

While CI is pending, query `mergeable` and `mergeStateStatus`; `CONFLICTING` or `DIRTY` requires an OPEN, head-bound
receipt and typed conflict gate binding old/resolved/upstream heads, preflight, files/hunks, semantic impact, rationale,
and deterministic content/diff digests from a canonical read-only reviewer task. The trusted supervisor recomputes
those tree/content and pairwise binary-diff digests from Git objects and rejects forged reviewer claims. A distinct real conflict-scoped `fluo-issue-implementer` must produce the exact commit and machine final output while the supervisor remains non-editing; task reuse is forbidden. Only machine-proven old-base/reviewed versus upstream/resolved patch equivalence with no overlap may inherit prior PASS receipts. Canonical changed/conflicting paths and diff shapes set the minimum scoped axes; reviewers may add but never omit axes. Ambiguous or cross-cutting impact reruns all. Never inherit BLOCK, stale, or cross-issue/PR evidence. Remediate the conflict blocker,
then require `pr-update` and exact-head CI before merge.

When a successor lane reconciles an existing canonical branch, worktree, and OPEN PR, reuse those identities instead
of creating duplicates. Rerun the full local triad against the observed head, then persist a `pr-adopt` receipt
binding the local, remote, and PR heads before entering `ci-pending`. A closed PR, stale head, mismatched issue
branch, or noncanonical worktree fails closed. Initialization, implementation/review acceptance, canonical
verification, conflict resolution, and reload all require a registered real Git worktree on the expected branch,
existing bound commits, and live `git rev-parse HEAD` equal to supervisor state.

Classify required CI on that exact head:

- `pass` -> `merge-ready`;
- `fixable-failure` -> `ci-fix-back`, then implementation, a new head, the full
  local triad, push, and CI again;
- `external-failure` -> `needs-human-check-terminal` without speculative code
  edits.

Green unrelated jobs do not satisfy required CI. Pending, stale, unavailable, infrastructure, policy, or approval
failures are not implementation defects.

## Merge and cleanup

`merge-ready` requires the local reviewed head, remote branch head, PR head, and
CI head to remain identical. Under lane merge authority, perform a squash merge and observe the PR as `MERGED`, a
non-null merge commit, and the linked issue as
`CLOSED`.

Then remove the worktree, local branch, and remote branch under cleanup authority. Record `done` only after all
required absence checks succeed. Incomplete cleanup is a terminal blocker and does not silently release a dependent
issue.

## Recovery

Before any remote action, re-read live Git and GitHub identity. On task restart, resume from the issue state and live
observations rather than repeating the last claimed action. The node returns typed transition evidence and receipts;
the parent validates them before updating the shared lane ledger.

Before creating a child, branch, worktree, or PR, load every compiled predecessor's isolated issue store and validate
it through
`supervisor-terminal.mjs`. Proceed only when every terminal is canonical
`done`, including observed merge, CLOSED issue, and cleanup. Missing, malformed,
or blocked predecessor evidence returns a typed dependency blocker without performing a mutation. The shared snapshot
may still name an earlier queue cursor while the lane DAG runs because the parent imports settled terminals in
topological order after the DAG settles.

Before that dependency gate, run the event-driven canonical dispatch gate:

```text
node .agents/skills/execute-lane/scripts/await-lane-dispatch.mjs \
  --root . --ledger .omo/lanes/<lane-id>.json
```

Do not treat the short start/attach interval as a terminal ledger conflict. Wait for the exact canonical binding. A
timeout or mismatched immutable binding remains fail-closed. The gate authenticates the binding against the native
run's key record and persisted submitted definition, and does not recompile current workflow source for an already
attached run.

## Stop

Stop with `done` only after observed merge and cleanup. Otherwise stop with one explicit human, policy, external,
cleanup, child-contract, or ledger blocker. Never report success merely because the DAG node or a child task returned.
