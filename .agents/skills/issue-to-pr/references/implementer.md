# Native issue implementer

This reference is the task prompt contract for the single implementation child.
The child implements; it does not orchestrate remote lifecycle.

## Required task input

The lead supplies the validated issue-to-pr input, absolute
`WORKTREE_PATH`, issue title/body, applicable governance documents, and, for
`fix-back`, only canonical unresolved blockers. Missing branch, worktree, mode,
or fix-back identity is a contract error.

## Authority

The implementer may:

- read and edit files only under `WORKTREE_PATH`
- add tests and documentation required by the behavior change
- add a changeset for user-impacting public package changes
- run changed-file diagnostics and relevant tests, builds, lint, and verifiers
- stage its scoped changes and commit on the assigned branch

The implementer must not:

- edit outside `WORKTREE_PATH`
- push or force-push
- create, edit, close, review, or merge a PR
- create, edit, close, or reopen an issue
- merge, rebase, amend, squash, or rewrite existing commits
- remove worktrees or branches
- publish packages
- insert a `Co-Authored-By` trailer
- judge its own merge readiness

Push and PR authority belongs only to the lead.

## Protocol

1. Verify the current directory is `WORKTREE_PATH` and the checked-out branch
   equals the supplied branch. In `fix-back`, do not create replacements when
   identity is wrong; report a contract error.
2. Read `CONTRIBUTING.md`,
   `docs/contracts/behavioral-contract-policy.md`, the PR template, and affected
   package README files.
3. Inspect the issue path and existing tests. Write a failing behavioral test
   first and run it to capture assertion-level RED.
4. Implement the smallest root-cause change, then run the test to GREEN.
5. Run changed-file diagnostics and the closest canonical verifier. Never claim
   an unrun check passed.
6. Add a changeset for public `@fluojs/*` user impact or state the concrete
   no-release rationale.
7. Stage only scoped files and create one new commit. In `fix-back`, append the
   commit; never rewrite prior history.
8. Confirm the resulting head differs from the supplied `starting_head_sha`.
   An unchanged head is a blocked result, not completion.

In `fix-back`, modify only the supplied blockers and directly necessary tests,
docs, contract companions, or release metadata. Mark a blocker remediated only
when its evidence has a passing verifier. Return ineligible or policy-dependent
items as remaining blockers without speculative edits.

## Task report

Return a machine-readable report containing:

- `lane_id`, issue number, mode, branch, and worktree
- previous head, new head, and commit SHA
- changed files
- every verification command and `passed`/`failed` status
- changeset path or no-release rationale
- addressed and remaining canonical blockers
- any contract error evidence

The report is evidence for the lead. It does not authorize push, PR creation,
merge, cleanup, or publish, and it must not claim the overall workflow is
complete.
