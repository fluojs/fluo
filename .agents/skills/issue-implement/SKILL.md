---
name: issue-implement
description: Local-only implementation stage under execute-lane. Implements one preflight-bound issue or remediates review/CI blockers in the same worktree, runs focused checks, and returns a new local commit without remote mutation.
---

# Issue implement

This is one stage under `$execute-lane`, not a standalone issue-to-PR
orchestrator. It consumes a fixed preflight contract and an assigned branch and
worktree. One scoped implementer edits, runs focused tests, and commits locally.

The lane order is:

`preflight -> issue-implement -> selected review -> verify-local -> sync-pr`

`verify-local` owns canonical local CI. `sync-pr` owns push and PR creation or
updates. A fix-back creates a new head and goes through selected re-review
before canonical local CI, regardless of whether review or CI found the blocker.
This stage has no DAG, session identity, or model-enforcement prerequisite.

## Input and binding

Read `references/workflow.md` for the exact machine interfaces, and
`references/implementer.md` for the task prompt. Import the validators from
`scripts/contracts.mjs`:

- `assertIssueImplementInput(input)` validates the exact version 1 input.
- `assertIssueImplementIdentity(input, identity)` validates the observed
  checkout, starting head, worktree, and optional PR before implementation.
- `assertIssueImplementResult(input, result)` validates local completion.
- `assertBlockerReconciliation(inputBlockers, addressedBlockers,
  remainingBlockers)` enforces complete canonical blocker reconciliation.

The only modes are `implement` and `fix-back`:

- `implement` has no blockers and `fix_back_attempt: null`.
- `fix-back` has unresolved, fix-back-eligible canonical blockers and a positive
  safe-integer `fix_back_attempt`. The lane owns retry policy; this stage has no
  attempt ceiling or origin-specific fix-back mode.
- Both modes accept `existing_pr: null` or an existing PR identity. Its number,
  URL, and head branch must be preserved; this stage never creates a PR.
- Both bind lane, issue, base branch, the lane's `issue-<number>` branch
  (retaining a title suffix when already present),
  `.worktrees/<branch>`, `starting_head_sha`, and `preflight_sha256`.

The lane supplies and validates the preflight artifact. It fixes implementation
scope, acceptance requirements, and review policy before dispatch. The stage
must retain its exact digest in output and cannot change the contract, choose
fewer review axes, or substitute a new preflight. Report scope conflicts to the
lane instead of silently widening or narrowing the task.

## Authority and completion

`implementerAuthority` permits only local edit, test, and commit; push and PR
creation are false. `leadAuthority` grants none of those mutations within this
stage: the lead validates the returned identity and evidence. Broader lead
verification belongs to `verify-local`, and remote authority belongs to
`sync-pr`. Neither actor may merge, mutate issues, clean up, or publish here.

Validate input and observed identity before edits. Follow the assigned scope,
run focused checks, and create a distinct new local commit. Completion requires
nonempty changed files and passed focused-check receipts, exact input identity
and preflight binding, and every input blocker accounted for exactly once as
remediated with no remaining blockers. `commit_sha` must equal the new
`head_sha`; `previous_head_sha` must equal `starting_head_sha`.

Return the exact object accepted by `assertIssueImplementResult`. A malformed
report, unchanged head, failing focused check, or unresolved blocker is not
completion. Report the evidence to the lane for retry or escalation, without
inventing a successful result or managing retries inside this stage. Local
completion does not authorize review PASS, local-CI PASS, push, or PR creation.

User-facing reports are Korean-first; technical identifiers remain unchanged.
