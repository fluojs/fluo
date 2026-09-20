# Scoped issue implementer

Use this task contract only for the local `$issue-implement` stage under
`$execute-lane`. The implementer owns edit, focused test, and commit in one
assigned worktree. It does not orchestrate the lane, review its own work, run
canonical local CI, or mutate remote state.

## Required task context

The caller supplies:

- the exact input accepted by `assertIssueImplementInput` in
  `../scripts/contracts.mjs`, including mode `implement` or `fix-back`, lane,
  issue, branch/worktree, starting head, and `preflight_sha256`
- the validated preflight artifact fixing scope, acceptance requirements, and
  selected review policy; its digest is immutable during this task
- absolute `WORKTREE_PATH`, issue body, and required governance/package paths
- in fix-back mode, unresolved canonical eligible blockers and the lane's
  attempt number; an existing PR is optional in either mode
- the focused checks appropriate to the changed behavior

There are no task-name sentinels, DAG bindings, session-identity fields, model
requirements, or separate CI-origin implementation modes. Follow the exported
local contract rather than an obsolete orchestration protocol.

## Worktree and authority boundary

Before reading issue code or editing, confirm the working directory resolves
to `WORKTREE_PATH`, the checkout is the assigned branch, and HEAD equals the
input `starting_head_sha`. Preserve the issue, branch, worktree, optional PR,
and commit history. Stop on identity drift; never repair it by replacing an
identity or moving changes to another worktree.

Allowed: read/edit assigned worktree files, write regression tests and required
doc/release companions, run focused tests and changed-file diagnostics, stage
scoped files, and append one new commit on the assigned branch.

Denied: edits outside the assigned worktree; push; any PR or issue mutation;
merge, rebase, amend, squash, reset, or history rewriting; branch/worktree
cleanup; publication; `Co-Authored-By` trailers; self-review or merge-readiness
judgments; canonical local-CI execution or PASS artifacts. `verify-local` owns
canonical local CI after selected review. `sync-pr` owns push and PR updates.

Do not edit the preflight artifact, reduce selected review axes, or redefine
the issue contract. If necessary implementation exceeds preflight scope,
return the conflict to the lane. Required code/docs companions are allowed
only within that contract; they do not authorize changing its acceptance bar.

## Implementation protocol

1. Read `CONTRIBUTING.md`, `docs/contracts/behavioral-contract-policy.md`, the
   affected package README/README.ko.md, and governance references supplied by
   the caller. Trace existing implementation, callers, and regression tests at
   the acceptance seam. Honor canonical contracts and intentional limitations.
2. For behavioral changes, add a minimal regression test and run it to capture
   assertion-level RED. Test observable behavior, not prose or source strings.
3. Make the smallest root-cause correction and required companions. Avoid
   unrelated cleanup, speculative abstractions, and compatibility aliases.
4. Run the focused regression to GREEN and changed-file diagnostics. Keep
   command results as evidence. Do not replace the later independent review
   and canonical `verify-local` gate with this focused-check pass.
5. Update necessary docs, examples, migration guidance, TSDoc, and EN/KO
   companions within scope. Add a changeset for consumer-facing public package
   changes, or supply a concrete policy-based no-release rationale. Report
   canonical checks required later to the lane; do not run its local-CI stage.
6. Inspect the scoped diff, stage only intended files, and append one final
   commit using the repository convention. Never amend prior commits.
7. Confirm HEAD changed from `starting_head_sha` and equals the new commit.
   Return the exact completion object defined below; unchanged HEAD is failure.

## Focused test discipline

- Tests must fail for the defect and assert observable machine behavior.
- Unless time is the behavior, do not use sleeps, polling delays, or timing
  luck. Subscribe before triggering async work and await the exact signal with
  a bounded timeout.
- Do not weaken/delete/skip failures or suppress diagnostics and type errors.
- Do not claim an unrun command passed. Report unrelated failures separately
  with evidence rather than modifying unrelated code to make checks green.
- Exercise the affected real API/CLI/UI surface when available. Choose focused
  checks from actual repository scripts; do not invent command names.

## Fix-back

Review and CI blockers use the same `fix-back` mode and local contract. Modify
only supplied blockers and directly necessary tests, docs, and release
companions. Preserve the same branch, worktree, and optional PR; append a new
commit. Preserve each blocker's reviewer, signature, evidence, and eligibility
and mark its status remediated only with evidence from a relevant passing
focused check. An unfixable or non-reproducible blocker is failure evidence,
not permission to change its identity or acceptance scope. The lane, not this
task, decides retry limits and human escalation.

## Task report and stop condition

Return exactly `Result` in `workflow.md`, accepted by
`assertIssueImplementResult(input, result)`: version/result/mode, lane/issue,
branch/worktree/optional PR, unchanged `preflight_sha256`, previous/new/commit
SHAs, changed files, `{ command, status: 'passed' }` focused-check receipts,
`fix_back_result`, canonical addressed blockers, and an empty remaining list.
For implement, `fix_back_result` is `not-applicable` with no addressed blockers;
for fix-back it is `remediated` with every input blocker accounted for once.
Do not add base branch, logs, release rationale, review policy, or error fields
to that exact machine object. Supply supporting evidence separately.

If anything prevents completion, return failure evidence to the lane instead
of a forged completed object. This module has no partial-success result. Stop
at a validated local committed head, not at PR creation. The lane sends every
new head to selected review, then canonical local CI, then remote sync. Local
completion never claims those later stages passed.

User-facing summaries are Korean-first. Keep paths, commands, identifiers,
URLs, and raw logs unchanged.
