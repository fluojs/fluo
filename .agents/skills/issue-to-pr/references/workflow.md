# Native `$issue-to-pr` workflow

The lead owns identity and remote side effects. One scoped implementer owns the
local edit-test-commit cycle.

## Preflight

1. Parse the invocation into the exact input accepted by
   `scripts/contracts.mjs` and call `assertIssueToPrInput`.
2. Resolve the repository root and issue with `gh issue view`. Verify the issue
   belongs to the current repository.
3. Read `CONTRIBUTING.md`,
   `docs/contracts/behavioral-contract-policy.md`,
   `.github/PULL_REQUEST_TEMPLATE.md`, and affected package README files before
   delegation.
4. Record the branch head as `starting_head_sha`. It is the freshness boundary
   for the entire run.

Do not mutate repository or GitHub state before valid input.

## Identity setup

### `new-pr`

Fetch the selected base and derive `issue-<number>-<short-title>`. The worktree
must be `.worktrees/<branch>` relative to the primary repository root. Create
that branch and dedicated worktree from `origin/<base_branch>`; use a local base
only when explicitly supplied as local-only. Existing branch or worktree
collisions are contract errors, not reuse opportunities. No PR may exist in the
input identity.

### `fix-back`

Reuse the supplied branch, worktree, and PR exactly. Before delegation, query
the current checkout and PR:

- worktree path equals `.worktrees/<branch>`
- checked-out branch equals `branch`
- PR number and URL equal `existing_pr`
- PR head branch equals `branch`
- issue, branch, worktree, and PR still represent the same lane item

Call `assertIssueToPrIdentity`. On mismatch, stop with
`blocked-child-contract-error`. Never repair identity by creating another
branch, worktree, PR, or issue. Pass only unresolved canonical blockers whose
`fix_back_eligible` value permits implementation; escalate ineligible blockers.

## Implementer dispatch

Read `references/implementer.md` and create one native task with a
self-contained prompt containing `TASK`, `DELIVERABLE`, `SCOPE`, `VERIFY`, and
`STOP WHEN`. Include the complete typed input, absolute assigned worktree path,
issue body, governance findings, and canonical blockers.

The task authority is exact:

- allowed: read and edit assigned worktree files; diagnostics, tests, builds,
  lint, and canonical verifiers; `git add`; `git commit`
- denied: edit outside the worktree; push; PR creation or mutation; merge;
  issue mutation; cleanup; publish; rewrite of prior commits

The implementer must return its commit SHA, resulting head SHA, changed files,
verification commands/results, release rationale, and blocker disposition.

## Child result gate

After the task is terminal, the lead verifies through repository state:

1. assigned worktree and checked-out branch still match the input
2. branch head is the reported commit SHA
3. branch head differs from `starting_head_sha`
4. no `Co-Authored-By` trailer exists
5. changed files remain inside the assigned worktree and requested scope
6. diagnostics and the closest canonical verifier passed
7. public `@fluojs/*` impact has a changeset or an explicit no-release rationale
8. fix-back changed only blocker-related code, tests, docs, or contracts

An unchanged head is never successful, even when the child reports passing
tests. Ask the same child session once for a contract-complete report when only
report fields are missing. If identity, head freshness, commit, or verification
cannot be established, stop as `blocked-child-contract-error`.

## Lead remote phase

For a direct `$issue-to-pr` invocation, only after the child result gate passes
may the lead push.

For an `$execute-lane` issue supervisor, return the validated local head before
this phase. The supervisor runs a fresh local contract/code/verification triad.
Only `ready-for-pr` or `ready-for-push` on that exact head may re-enter this
remote phase.

For `new-pr`:

1. push the assigned branch without force
2. create exactly one PR with the repository template
3. include `Closes #<issue-number>`
4. query the PR and bind its number, URL, and head branch to the run identity

For `fix-back`:

1. push the new commit to the same remote branch without force
2. do not create or edit a PR
3. query the existing PR and confirm it now observes the new head

The lead or authority-bound issue supervisor may push and create/update the
single canonical PR; the implementer may not. Direct `$issue-to-pr` does not
merge, close, clean up, or publish. The issue supervisor performs merge and
cleanup only after exact-head CI PASS under `$execute-lane`.

## Typed completion

Build the exact object accepted by `assertIssueToPrResult`. Completion requires:

- `result: completed`
- unchanged lane, issue, branch, worktree, and PR identity
- `previous_head_sha` equal to input `starting_head_sha`
- a distinct `head_sha`, with `commit_sha` equal to it
- at least one changed file and passed verifier receipt
- `fix_back_result: not-applicable` for `new-pr` or `remediated` for `fix-back`
- no remaining blockers

Validate before reporting. Report in Korean with technical values unchanged.
Do not report completion for malformed output, unchanged head, failed verifier,
or unresolved blocker.
