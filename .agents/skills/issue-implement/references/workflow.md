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

The lead first runs `../../execute-lane/scripts/workflow-preparation.mjs implement
<input.json>` with `{version:1,stage:"implement",root,accepted_contract_path,
contract,input}`. `root` and the authoritative contract file path are absolute;
`input` is the exact Input above for either implement or fix-back. The script
checks accepted-file equality and issue/preflight digest, realpaths, common Git
directory, branch, starting HEAD and clean status, using the existing validators.
It returns `{status:"prepared",kind:"implement-input",dispatch,input,contract,
prerequisites}` only on success. Remote PR observations still belong to the lead.

When the contract declares `validation_requirements`, each local command names
its tools (`name`, absolute `path_dirs`) and worktree-relative artifacts (`path`,
`kind:"file"|"directory"`). Required dependency directories and concrete dist
files must exist. Commands without PATH assignments search declared directories
then inherited PATH for executable regular files. Leading `PATH=... cmd` and
`export PATH=...; cmd` search only the command's PATH in order; `path_dirs` does
not augment it. Literal single/double quotes are supported. Unquoted or
double-quoted `$PATH`/`${PATH}` expands inherited PATH at its position; single
quotes preserve it literally. Relative/empty entries resolve from the assigned
worktree. The script only parses strings and inspects files: it never executes
the validation command, tools, a shell or command substitution. It checks
artifact kinds and lists all missing prerequisites with their commands.
Good: `PATH=/opt/node/bin:/opt/pnpm/bin:$PATH pnpm test:node` or
`export PATH="/opt/node/bin:/opt/pnpm/bin:$PATH"; pnpm test:node`.
Wrong: `PATH=/opt/node/bin pnpm test:node` with pnpm only in inherited PATH or
declared `/opt/pnpm/bin`. Unsupported command/backtick substitutions (for example
`PATH=$(find-tools) pnpm test`), other variables/parameter operations, unquoted
tilde/globs, escapes, malformed quotes and wrapped/later/multiple PATH assignments
produce typed `input-preparation`, `fix_back_eligible:false`; inherited PATH
cannot stand in for an unresolvable command PATH. The lead supplies PATH and completes
install/build before dispatch. CI-only `{validation,kind:"ci-only",check,reason}`
entries are returned separately, never as local success. Old contracts retain
their digest and return `prerequisites.status:"undeclared"` without inference.
Input/environment failures are nonzero `input-preparation` blocks with
`fix_back_eligible:false`; fix the input or return to preflight for scope changes.
This read-only preparation does not dispatch, modify Git, query PRs or write a ledger.

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

Use `subagent_type: "fluo-issue-implementer"` with `run_in_background: true`
and `references/implementer.md` as the task contract. The registered agent
reads that reference from the assigned worktree first. Supply `TASK`,
`DELIVERABLE`, `SCOPE`, `VERIFY`, and `STOP WHEN`, the complete validated input,
the preflight artifact, absolute worktree, issue body, and canonical blockers.
Do not add fields to the machine input just to carry prompt context.
After validating `Result`, identify the actual agent in the lead's separate
`record` success wrapper as `agent: "fluo-issue-implementer"`. Do not add that
field to `Input`, `Result` or preflight digest input. An unavailable target is
typed `input-preparation` with `fix_back_eligible: false`, never a category
substitution or implementation fix-back.

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

Immediately after either child mode returns, even with no Result, the lead runs
`../../execute-lane/scripts/workflow-preparation.mjs implement-result <input.json>`
or calls `prepareImplementResult` from that module. The exact wrapper is
`{version:1,stage:"implement-result",root,accepted_contract_path,contract,input,
result}` with absolute root/accepted path, unchanged accepted contract and
Input, and the original Result or `null`. Do not reuse `implement` preparation:
completion must admit a new HEAD rather than require the starting HEAD.

Only `{status:"accepted",kind:"implement-result",result}` (CLI stdout, exit 0)
allows the unchanged Result into the existing success record and subsequent
review preparation. Admission independently authenticates contract equality and
issue/digest binding, realpath/common Git repository and current branch, actual
HEAD/commit equality, starting ancestry, nonempty committed diff/changed_files
equality and scope, clean staged/unstaged/untracked state, and no live worktree
commands or descendants. Still inspect the commit for forbidden
`Co-Authored-By` trailers. Pure validators remain unchanged.

On macOS, process observation uses `ps` and `lsof`; on Linux it uses `ps` and
`/proc/<pid>/cwd`. The child and lead run under the same effective user. Cwd
roots cover that user's commands, with descendants from the system-wide parent
table even outside the worktree. Component boundaries exclude sibling paths;
the observer itself is excluded. A live process whose cwd cannot be read,
failed observation or unsupported environment is `input-preparation` with
`fix_back_eligible:false` (CLI stderr, exit 1), never an empty list.
This is a point-in-time check and does not lock the process tree.

Observed unfinished work returns a separate `{version:1,status:"incomplete",
kind:"incomplete-run",lane_id,issue_number,mode,preflight_sha256,worktree,
starting_head_sha,current_head_sha,branch,changes,result,processes,reasons}`
(CLI stderr, exit 2). `worktree` is real; changes hold staged/unstaged/untracked
paths; result is `{present,valid,error}`; process entries contain
`{pid,ppid,command,attribution}`, with `{kind:"cwd",path}` or
`{kind:"descendant",ancestor_pid}` attribution. Reasons preserve all observed
unfinished causes. Missing Result stays incomplete even on a clean new commit.
Retain this evidence, monitor existing commands, then resume the same assignment
and rerun admission after it returns. Do not reexecute commands, kill processes,
auto-commit, automatically retry or record success before acceptance.
Binding mismatch/observation failure is an input block; unavailable values are
not guessed. No Result keys, stored facts/digests, authority or engine
decisions change. Foreground instructions or turn termination cannot substitute
for admission. Focused test receipts remain self-report, not independent test
execution proof. Keep focused-check logs
and the changeset or explicit policy-based no-release rationale as supporting
evidence, outside the exact result object.

If completion cannot be established, report evidence to the lane rather than
inventing partial-success fields. There is no failure-result variant in this
module and no stage-owned retry loop; the lane records failure and decides
retry or escalation.

## 4. Return to the lane

Stop at the validated local commit. The lane dispatches selected review using
the unchanged preflight policy on that exact head, then `sync-pr` for remote
synchronization. `verify-local` remains available after selected review for
explicitly requested full local reproduction or diagnosis; CI/configuration,
manifests and lockfiles do not automatically require its receipt or a waiver.
Every fix-back
new head needs focused checks and selected re-review. Neither focused-check
receipts nor blocker reconciliation substitute for independent review or full
exact-head GitHub CI. Report omitted full local CI as not run, never PASS.
Applicable current-head local failures still require fix-back. No push, PR mutation, merge, cleanup, or publish occurs
in this stage, and there is no standalone orchestration or DAG requirement.
