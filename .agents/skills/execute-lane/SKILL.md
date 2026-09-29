---
name: execute-lane
description: Canonical Fluo lane execution with focused local checks, selective exact-head reviews, conditional full local CI, and full GitHub CI. No DAG or session-bound execution identity.
---

# Execute lane

This is the sole execution orchestrator. Stage skills perform one action and
return evidence; they do not own retries or run independent PR workflows.
Git/GitHub supplies live branch, worktree, PR, CI, and merge observations.
The lane file retains intent, accepted contracts, and head-bound evidence.
No DAG, supervisor graph, journal identity, or session rollover is required.

## Files and intake

- `scripts/lane-v4.mjs`: pure next-action engine.
- `scripts/lane-v4-cli.mjs`: observation, validation, and persistence.
- `.omo/lanes-v4/<lane-id>.json`: execution state.

Run commands from the repository root using the full script path:

```text
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs init --from-lane-v2 .omo/lanes/<lane-id>.json
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs plan --root . --lane <lane.json> --issue <n>
```

The v2 ledger supplies the lane id, base, confirmed issues, dependencies, and
merge grant. Its source path and byte digest remain provenance. External
issue dependencies are rejected. Read predicted conflicts before dispatch.
Hand-initialized lanes need an explicit merge grant; importing a ledger does
not authorize expanding its issue set.

## Canonical order

```text
preflight -> implement + focused tests -> selected exact-head reviews
                                      <- fix-back if review blocks
          -> verify-local only when full local CI is required
          -> create-pr / push -> full remote CI
                                    <- fix-back if CI fails
          -> merge authority + mergeability gate -> merge -> cleanup -> done
```

Every new implementation or conflict-resolution head repeats the selected
reviews after focused checks. Ordinary changes proceed to publication without
duplicating the full CI suite locally. CI execution/configuration changes retain
the post-review `verify-local` gate; the engine classifies the actual issue diff,
not unrelated upstream changes. Unknown scope is conservative.
Reviewers inspect focused test evidence and test adequacy; they do not wait for
or run a later full local CI stage. A review PASS
alone neither publishes a PR nor authorizes merge.

## Stage ownership

| Engine action | Stage contract | Output |
| --- | --- | --- |
| preflight | ../issue-preflight/SKILL.md | Fixed implementation contract and review policy |
| implement, fix-back | ../issue-implement/SKILL.md | New local commit and focused test evidence |
| review | ../review-head/SKILL.md | Exact-head, contract-bound selected-axis verdict |
| verify-local | ../verify-local/SKILL.md | Post-review full local CI receipt when required |
| create-pr, push | ../sync-pr/SKILL.md | Observed canonical PR and remote head |

Resolve sibling paths relative to this skill. Read the stage before executing
its action. Only the lead writes shared lane state and performs remote writes.
Implementers stay in their assigned worktree; reviewers are read-only.

## Preflight and review policy

Preflight is mandatory before implementation, including resumed lanes without
an accepted contract. It fixes scope, non-goals, acceptance and verification
criteria, source/base bindings, expected paths, and review axes. A normal
implementation commit does not itself invalidate the contract. Changed intent,
invalid or changed approved base, or out-of-scope changes require preflight
again. The accepted `base_sha` is a pinned commit: validate that it remains
an ancestor of both the issue head (when present) and the observed
`origin/<base_branch>`. An unrelated advance of that branch alone does not
invalidate the approved base, review, or local receipt. Scope and review axes
use the current merge-base-to-head issue diff, excluding upstream changes
incorporated by a merge or rebase; local verification retains the pinned
base. An integration head still requires focused checks and new reviews; full
local CI is required when its actual issue diff changes CI execution/configuration.
Re-registering the same
preflight digest keeps existing head-bound facts and timestamps; changing
the digest invalidates them.

| Actual change role | Minimum review axes |
| --- | --- |
| Explanatory documentation only | contract |
| Tests/fixtures only | code, verification |
| Runtime/API, mixed, unknown, workflow instructions, or governance | all three |

Every omission has a reason. The lead reads the actual diff itself before
review, reconciles all paths against approved scope, and expands axes as
needed. File extensions are insufficient: skills, agent instructions, and
machine-consumed Markdown can govern execution. Implementers cannot reduce
review scope. Aggregate exactly the effective axes; never fabricate PASS for
an omitted axis or mix heads/contracts. Record complete reviewer envelopes.

## Decision loop and recovery

1. Run `plan` (or `plan-all`) using fresh observations.
2. Execute exactly the returned action. Independent ready issues may run in
   parallel worktrees; selected review axes dispatch as one background batch.
3. Validate and record outcomes through the CLI. A child `ok: true` is
   completion telemetry, not a replacement for contract/head-bound evidence.
4. Run `plan` again until every issue is observably done or has a typed
   blocker requiring a decision.

Failed or malformed children requeue under lane retry accounting. An exhausted
attempt budget is resumable; never hide failure as success. Preserve the same
issue/branch/worktree/optional PR during fix-back. Use a fresh implementation
child for remediation, carrying canonical blockers and accepted preflight.

Dependencies release from fresh GitHub issue-closed observations, not task
completion. Use the CLI `watch` through a monitor to receive transitions and
stall notices. For `wait-ci` subscribe once to `gh pr checks --watch`.
Disable the GitHub pager in monitor commands (`GH_PAGER=cat`) so an earlier
identity query cannot block the watch inside the terminal pager.
Do not poll from the coordinator or create a child merely to wait.

## Local and remote gates

Public consumer-visible package changes require a Changeset before review.
Package-root README/LICENSE files ship too; unrelated root docs do not imply
package release impact. Use the release governance contract.

Focused checks must exercise the changed behavior and meet preflight criteria;
retain their commands, results and real-surface evidence for exact-head review.
Full local CI is mandatory for CI execution/configuration changes and remains
available for requested reproduction or diagnosis. It is not an unconditional
publication prerequisite for ordinary changes. A current recorded local failure
still blocks progress; never manufacture a passing receipt to bypass it.

Full local CI runs only after selected review PASS at the current head. Its checks,
build ordering, scope, and receipt rules live in `verify-local`. Verification
must never run concurrently with a child writing the same worktree. A new head
or accepted contract invalidates earlier evidence.

Before merge, require current-head review and any required full local CI, green current-head
remote CI, an explicit `MERGEABLE` state, and a merge grant. `UNKNOWN`
mergeability waits; a real conflict resolves on a new head and repeats focused
checks, reviews and the applicable CI gates. Advancing main alone does not mandate merging it into the issue
branch. Publishing stays GitHub Actions and Changesets only. The lead owns
merge and cleanup, never a stage reviewer.

For conflicts, preserve both intended behaviors and return the resolved new
head through focused checks, review and the applicable CI gates. Do not reuse old approvals by claiming the
patch is equivalent. Keep conflict resolution inside the existing identity.

After observed merge, clean the issue and review worktrees and branches under
the existing grant, record cleanup, and cancel issue children. Keep reviewer
sessions available for readjudication until the issue is done; implementation
children can be retired once their output is verified. No session identity is
needed to resume the lane from persisted facts and live observations.

## Verification

```text
node --test .agents/skills/execute-lane/scripts/*.test.mjs
```
