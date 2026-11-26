---
name: issue-implement
description: Local-only implementation stage under execute-lane. Implements one preflight-bound issue or remediates review/CI blockers in the same worktree, runs focused checks, and returns a new local commit without remote mutation.
---

# Issue implement

This is one stage under `$execute-lane`, not a standalone issue-to-PR
orchestrator. It consumes a fixed preflight contract and an assigned branch and
worktree. One scoped implementer edits, runs focused tests, and commits locally.

Use `subagent_type: "fluo-issue-implementer"` and `run_in_background: true` for
both modes, matching the engine's `dispatch`. The registered agent first reads
`references/implementer.md` in its assigned worktree. Preserve the exact `Result`;
the lead adds `agent: "fluo-issue-implementer"` only to its successful `record`
wrapper. Missing registration or runtime unavailability produces a typed
`input-preparation` block with `fix_back_eligible: false` under `execute-lane`'s
dispatch admission contract. Never substitute a category worker or treat this
input block as an implementation defect.

The lane order is:

`preflight -> issue-implement + focused checks -> selected review -> sync-pr`

Only for explicitly requested reproduction or diagnosis, `verify-local` runs
full canonical local CI after review. No approved changed path, including
CI/configuration, manifests or lockfiles, automatically requires that run,
receipt or waiver. `sync-pr` owns push and PR creation or
updates. A fix-back creates a new head and goes through selected re-review
before publication, regardless of whether review
or CI found the blocker. Full GitHub CI remains the final verification gate.
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

Before assigning a fix-back, the lead confirms the regression's supported
runner, complete projected test/necessary-fixture patch, test-body assertion
identity and first source file/positive line, and availability of real GREEN
on the corrected head with the identical command/argv. Supported capture
runners are the existing Node TAP runner and the canonical packages Vitest
runner documented in `../review-head/SKILL.md`. Setup, hook, import or runtime
failure is not assertion RED. A regression outside those boundaries returns
to preparation; do not duplicate it in another runner merely to obtain a
receipt. This check grants neither implementers nor reviewers lead capture
authority.

For test-only executable fix-back, follow the lead-owned
[decision and evidence retention rules](../execute-lane/references/operations.md#test-only-executable-fix-back).
A focused pass does not establish remediation: the complete test/fixture
projection onto the actual previous head must fail in the named test-body
assertion with the supported runner, and that same selection must pass on the
corrected head with identical command and argv. If the projection passes,
return the observation to the lead rather than claim remediation; a diagnostic
mutation failure cannot supply RED. The missing evidence is non-fixable
preparation input, not a product verdict. Leave any required canonical blocker
unresolved for maintainer/scope adjudication. Do not relabel the fix-back;
only independently extra coverage qualifies for separately approved ordinary
implementation after original acceptance and review are satisfied without
it or mutation evidence and no required blocker remains.

Before dispatch in either mode, the lead runs
`../execute-lane/scripts/workflow-preparation.mjs implement <input.json>`.
The wrapper is exactly `{version:1,stage:"implement",root,
accepted_contract_path,contract,input}` with absolute root/accepted-contract
path and the unchanged Input below it. Preparation authenticates the accepted
contract and issue/digest, observes worktree realpath/common repository,
branch/starting HEAD and clean status, and reuses the input/identity validators.
PR remote observation remains the lead's responsibility.

Success is `{status:"prepared",kind:"implement-input",dispatch,input,contract,
prerequisites}`. Use its registered dispatch and original input/contract.
For local `validation_requirements`, commands without PATH assignments search
absolute `path_dirs` then inherited PATH for executable regular files. Leading
`PATH=... cmd` and `export PATH=...; cmd` instead search only the command's PATH
in order; `path_dirs` does not augment it. Literal single/double quotes are
supported; unquoted or double-quoted `$PATH`/`${PATH}` expands inherited PATH at
that position, while single quotes preserve it literally. Relative/empty entries
resolve from the assigned worktree.
The non-export form is limited to one simple command; unquoted command
boundaries are unsupported. For example, reject
`PATH=/cmd-tools pnpm --version && node check.mjs`; use
`export PATH=/cmd-tools; pnpm --version && node check.mjs` for persistence.
Quoted operators such as `pnpm '&&' ';'` remain literal arguments.
Worktree-relative dependency directories
and concrete build files are checked for existence and kind. The lead supplies
the declared PATH and completes install/build prerequisites before dispatch.
Preparation never executes tools, commands, install, build or tests. Missing
items name the affected commands and block with `kind:"input-preparation"` and
`fix_back_eligible:false`. Resolve the missing environment before retrying;
return contract conflicts to preflight. CI-only entries remain separate remote
checks, never local successes. A legacy contract without requirements remains
valid with `prerequisites.status:"undeclared"`; infer neither prerequisites nor
PASS. Preparation adds no keys to Input/Identity/Result and writes no ledgers.

Good: `PATH=/opt/node/bin:/opt/pnpm/bin:$PATH pnpm test:node` or
`export PATH="/opt/node/bin:/opt/pnpm/bin:$PATH"; pnpm test:node`.
Wrong: `PATH=/opt/node/bin pnpm test:node` when pnpm exists only in inherited
PATH or declared `/opt/pnpm/bin`. Static parsing never executes a shell or
substitution. Unsupported command/backtick substitution, other variables or
parameter operations, unquoted tilde/globs, escapes, malformed quotes and
wrapped/later/multiple PATH assignments block as `input-preparation` with
`fix_back_eligible:false`; for example `PATH=$(find-tools) pnpm test` cannot pass
by finding an inherited pnpm.
Wrapped env resets (`env -u PATH pnpm test`, `env --unset=PATH pnpm test`,
`env -i pnpm test`, and the `--unset PATH`, `-uPATH`, `--ignore-environment`
and `env -` forms) also produce that typed block. They cannot use declared or
inherited tools to infer success. `pnpm 'env -u PATH' '-i'` and
`env -u OTHER pnpm 'PATH='` retain their ordinary argument behavior.
Short env option groups are scanned in order: `-vi` and `-iv` also reset PATH.
`-u` consumes its attached or following name; `-vuindirect` keeps that name
literal. Unknown env options, including unmodelled long options and their
operands, receive the same typed block.

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
or missing report still requires the lead to call
`../execute-lane/scripts/workflow-preparation.mjs implement-result <input.json>`
immediately after either mode's child returns. Supply exactly
`{version:1,stage:"implement-result",root,accepted_contract_path,contract,input,
result}` with absolute paths and the original Result, or `null` if absent.
Only `{status:"accepted",kind:"implement-result",result}` permits the existing
success record and review preparation. Admission observes the actual current
commit, ancestry, scoped diff, clean worktree and live commands/descendants;
it does not reuse the starting-HEAD-only preparation or execute focused tests.
Foreground execution or a turn ending is not structural completion evidence.
An `incomplete-run` (CLI exit 2) preserves result validity, Git residue and
attributed processes. Retain it, watch existing commands and resume the same
assignment without rerunning commands, killing processes, auto-committing or
automatically retrying. `input-preparation`, `fix_back_eligible:false` (exit 1)
means binding or observation could not be established; repair access/input first.
See workflow.md for the wrapper and process observation boundary. The exact
version 1 Input/Identity/Result and authority objects remain unchanged.

A malformed
or unsuccessful raw return must first be retained by the lead through
`lane-v4-cli.mjs retro-record --kind implementer`; include available task/head,
failed command and raw log references without inventing missing measurements.
The separate retrospective observation is not implementation acceptance.
See `../retrospective-lane/SKILL.md` for work-unit capture and the lane-end analysis.

A malformed
report, unchanged head, failing focused check, or unresolved blocker is not
completion. Report the evidence to the lane for retry or escalation, without
inventing a successful result or managing retries inside this stage. Local
completion does not authorize review PASS, local-CI PASS, push, or PR creation.

User-facing reports are Korean-first; technical identifiers remain unchanged.
