# Local `$issue-implement` workflow

The lane calls this stage after preflight. It prepares or selects the canonical
branch/worktree and captures its starting head before dispatch. This stage
neither orchestrates the lane nor creates replacement identities.

## Exported machine contract

`scripts/contracts.mjs` exports six values:

- `assertIssueImplementInput(input)`
- `assertIssueImplementIdentity(input, identity)`
- `assertIssueImplementResult(input, result)`
- `assertBlockerReconciliation(inputBlockers, addressedBlockers, remainingBlockers)`
- frozen `implementerAuthority`: edit/test/commit true, push/create_pr false
- frozen `leadAuthority`: edit/test/commit/push/create_pr all false

Validators return normally on valid input and throw a `TypeError` on invalid
input. Objects have exact keys: missing or extra keys are rejected. These are
the interfaces, expressed in TypeScript notation for callers (the module is
JavaScript):

```ts
type Pr = { number: number; url: string; head_branch: string };
type Blocker = {
  reviewer: 'contract' | 'code' | 'verification';
  signature: string;
  evidence: string;
  fix_back_eligible: boolean;
  status: 'unresolved' | 'remediated';
};
type Input = {
  version: 1;
  lane_id: string;
  issue_number: number;
  issue_url: string;
  issue_title: string;
  base_branch: string;
  branch: string;
  worktree: string;
  starting_head_sha: string;
  preflight_sha256: string;
  mode: 'implement' | 'fix-back';
  existing_pr: Pr | null;
  blockers: Blocker[];
  fix_back_attempt: number | null;
};
type Identity = {
  branch: string;
  worktree: string;
  checked_out_branch: string;
  head_sha: string;
  pr: Pr | null;
};
type Result = {
  version: 1;
  result: 'completed';
  mode: 'implement' | 'fix-back';
  lane_id: string;
  issue_number: number;
  branch: string;
  worktree: string;
  pr: Pr | null;
  preflight_sha256: string;
  previous_head_sha: string;
  head_sha: string;
  commit_sha: string;
  changed_files: string[];
  verification: { command: string; status: 'passed' }[];
  fix_back_result: 'not-applicable' | 'remediated';
  addressed_blockers: Blocker[];
  remaining_blockers: Blocker[];
};
```

Issue/PR numbers are positive safe integers. Git SHAs are 40 lowercase hex
characters; `preflight_sha256` is 64 lowercase hex characters. Branches use
the lane's `issue-<input issue_number>` identity (an existing title suffix is
retained, not generated as a second identity), and the worktree must equal
`.worktrees/<branch>`. The absolute assigned worktree is task context, not an
extra machine input key.

`implement` requires empty blockers and a null attempt. `fix-back` requires
nonempty unresolved blockers, all `fix_back_eligible: true`, and a positive
safe-integer attempt with no stage-level ceiling. Both accept a nullable PR;
a supplied PR must name the input branch. Canonical blocker fields are
validated by the shared `.agents/workflow-contracts/contracts.mjs` module.
Reviewer/signature pairs are unique. CI evidence uses the same canonical shape
(for example reviewer `verification`), not an origin-specific mode or schema.

## 1. Validate the preflight and identity boundary

The lane supplies the validated preflight artifact and its `preflight_sha256`
with the issue body, acceptance scope, governance paths, and review policy. The
lane is responsible for proving the digest names its current artifact for this
issue. This module checks digest format and exact input/output binding; it does
not load the lane engine or independently authenticate the artifact.

If no implementation checkout exists, the lead creates the exact branch
stored in the lane and `.worktrees/<branch>` from the accepted base, then
captures `starting_head_sha`. Never derive a different branch from the issue
title. Existing identities are reconciled, not replaced on a collision.

Call `assertIssueImplementInput` before edits. Observe the checkout rather than
trusting a child report. Resolve the absolute worktree path, confirm it belongs
to the intended repository, check its branch and `git rev-parse HEAD`, and call
`assertIssueImplementIdentity` with that observation. Its `head_sha` must equal
`starting_head_sha`. Resolve issue identity against the repository; when a PR
exists, confirm its number, URL, and head branch match the supplied identity.
The local branch may be ahead of its remote PR after a prior local commit;
remote-head synchronization is not this stage's job.

On collision, mismatch, dirty unrelated changes, missing preflight, or a scope
conflict, return the evidence to the lane. Do not switch branches, create a
replacement issue/PR/worktree, change preflight, or expand authority.

## 2. Dispatch one scoped implementer

Use `references/implementer.md` as the task contract. Supply `TASK`,
`DELIVERABLE`, `SCOPE`, `VERIFY`, and `STOP WHEN`, the complete validated input,
the preflight artifact, absolute worktree, issue body, and canonical blockers.
Do not add fields to the machine input just to carry prompt context.

The implementer owns edit, focused test, and commit only. It cannot reduce
preflight review axes or redefine acceptance scope. Review-origin and
CI-origin fix-back are identical local edit/test/commit work on the supplied
branch/worktree and optional PR. Only blocker-related changes and required
companions are in fix-back scope.

## 3. Validate local completion

The implementer returns `Result` above. Validate it with
`assertIssueImplementResult(input, result)`. Completion requires:

- exact lane/issue/branch/worktree and optional PR identity
- unchanged `preflight_sha256`
- `previous_head_sha` equal to the input starting head
- a distinct new `head_sha`, equal to `commit_sha`
- nonempty changed files and focused verification entries, all passed
- `not-applicable` with no addressed blockers for implement, or `remediated`
  with every input blocker represented exactly once for fix-back
- preserved blocker reviewer, signature, evidence, and eligibility; only status
  changes from unresolved to remediated
- no remaining blockers

Before accepting the result, the lead observes the assigned checkout again,
checks the actual head against the report, and inspects the committed diff
against the starting head and preflight scope. Confirm there is a real scoped
change, no unrelated staged/uncommitted residue, no rewritten starting history,
and no `Co-Authored-By` trailer. The pure validators check supplied values, not
Git state, command execution, or content-level scope. Keep focused-check logs
and the changeset or explicit policy-based no-release rationale as supporting
evidence, outside the exact result object.

If completion cannot be established, report evidence to the lane rather than
inventing partial-success fields. There is no failure-result variant in this
module and no stage-owned retry loop; the lane records failure and decides
retry or escalation.

## 4. Return to the lane

Stop at the validated local commit. The lane dispatches selected review using
the unchanged preflight policy on that exact head, then `verify-local` for
canonical local CI, then `sync-pr` for remote synchronization. Every fix-back
new head needs selected re-review before local CI. Neither focused-check
receipts nor blocker reconciliation substitute for independent review or
canonical verification. No push, PR mutation, merge, cleanup, or publish occurs
in this stage, and there is no standalone orchestration or DAG requirement.
