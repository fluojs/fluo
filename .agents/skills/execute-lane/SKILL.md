---
name: execute-lane
description: Canonical Fluo lane execution with focused local checks, selective exact-head reviews, explicit local reproduction, and full GitHub CI. No DAG or session-bound execution identity.
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

Before initialization read [operations.md](references/operations.md#files-and-intake)
for v2 intake and retry validation. Before recording state read that section's
exclusive SQLite write-lock and atomic publication rules. Existing lanes are never
reset. V2 source bytes remain provenance; import does not expand authority.

## Canonical order

```text
preflight -> implement + focused tests -> lead's preflight-selected pnpm test:node
          -> selected exact-head reviews <- fix-back if review blocks
          -> verify-local only for explicitly requested full local reproduction
          -> create-pr / push -> full remote CI
                                    <- fix-back if CI fails
          -> merge authority + mergeability gate -> merge -> cleanup -> done
```

Every implementation, fix-back or conflict-resolution head repeats focused
checks, the lead's acceptance-specific `pnpm test:node` when preflight selects
it, then fresh required reviews. Preserve the CI command's file set and default
inter-file concurrency; split or serial passes do not replace it. Before
dispatch, follow
[CI Node concurrency before review](references/operations.md#ci-node-concurrency-before-review)
for prepared runtime/build conditions, authenticated receipts and timeout
diagnosis. This is a selected pre-review check; full canonical
`pnpm verify:local` remains explicitly requested and post-review.
Only the Git-authenticated explanatory-document
exception below can retain prior code/verification PASS.
All approved changes, including CI execution,
configuration, manifests and lockfiles, proceed to publication without an
automatic full local CI gate, receipt or waiver requirement. Unknown or expanded
scope still requires preflight reconciliation.
Reviewers inspect focused test evidence and test adequacy; they do not wait for
or run a later full local CI stage. A review PASS
alone neither publishes a PR nor authorizes merge.

## Stage ownership

| Engine action | Stage contract | Output |
| --- | --- | --- |
| preflight | ../issue-preflight/SKILL.md | Fixed implementation contract and review policy |
| implement, fix-back | ../issue-implement/SKILL.md | New local commit and focused test evidence |
| review | ../review-head/SKILL.md | Exact-head, contract-bound selected-axis verdict |
| Explicit reproduction (not an automatic engine action) | ../verify-local/SKILL.md | Authenticated post-review full local CI receipt or failure evidence |
| create-pr, push | ../sync-pr/SKILL.md | Observed canonical PR and remote head |

Resolve sibling paths relative to this skill. Read the stage before executing
its action. Only the lead writes shared lane state and performs remote writes.
Implementers stay in their assigned worktree; reviewers are read-only.

### Registered dispatch and admission

Use the returned `dispatch` as `subagent_type` with `run_in_background: true`.
Only registered stage agents may supply success. A missing/unavailable route or
invalid agent identity fails closed as typed `input-preparation` with
`fix_back_eligible: false`; never substitute a category worker or dispatch a
product fix-back for an input block. The lead records the actual agent identity.
Stored legacy facts retain their original admission rules and bindings.
Read [operations.md](references/operations.md#registered-dispatch-and-admission)
before stage dispatch or success admission for the full registration and identity
contract.

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
base. An integration head still requires focused checks, any preflight-selected
CI Node concurrency check and fresh required reviews; full local CI runs only
for explicitly requested reproduction or diagnosis.
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
an omitted axis or mix heads/contracts without authenticated retention.
Record complete reviewer envelopes.

The effective policy, approved axis floor and policy digest never shrink for
retention. The CLI alone may select fresh `contract` review while retaining
previous canonical code/verification PASS from the same contract and policy.
It observes each head's merge-base with immutable origin/base, both authored
path sets and the head-to-head diff using `--no-renames -z`. Only their authored
intersection determines the change role. That nonempty delta must be
explanatory Markdown in the closed retention allowlist; instructions,
governance, generated or machine-read Markdown, tests, fixtures and unknown
roles are excluded. All non-explanatory paths in the union of authored paths
must have identical raw blob SHA-256 and Git modes at both heads. Missing or
uncertain observation means full review. See `review-head` for the stored proof
shape and validation. User-supplied retention or equivalence claims grant nothing.

### Workflow input preparation

Before preparing preflight, implementation/fix-back or review input, read
[operations.md](references/operations.md#workflow-input-preparation).
Use `preflight` for authenticated caller searches, `finalize-preflight` for
the read-only child's digest-free `contract_input`, and `implement` to verify
the accepted contract, assigned checkout and declared prerequisites before
either implementation mode. Finalization returns a contract, not a dispatch;
the lead records it separately. Local commands declare executable tool search
paths and dependency/build artifacts; CI-only checks remain remote evidence.
Immediately after every implement/fix-back child returns, run
`workflow-preparation.mjs implement-result <input.json>`, even without a Result.
Use exactly `{version:1,stage:"implement-result",root,accepted_contract_path,
contract,input,result}` with the original assignment and Result or `null`.
Only `status:"accepted"` admits its unchanged `result` to the existing success
`record` and subsequent review preparation. The gate independently observes
Git identity, committed scope/diff, clean status and worktree commands and
descendants; foreground instructions or a child ending its turn prove none of
these. `kind:"incomplete-run"` preserves all observed unfinished work. Retain
that wrapper, watch existing commands, then resume the same assignment without
restarting commands, killing processes, auto-committing or inventing a Result.
Observation failure is `input-preparation`, `fix_back_eligible:false`; restore
observation before proceeding. The full interface is in operations.md.
Preparation never installs, builds, tests, writes ledgers or dispatches children.
Large review results retain bounded authenticated transfer files; small review
CLI calls and JSON stay unchanged. Follow
`../review-head/SKILL.md#bounded-complete-review-transfer` for the manifest,
fixed byte/line and total limits, complete `review-read` consumption and
non-fixable input-preparation failures. Every axis must consume the identical
complete common/readable_index before judging; transfer never replaces existing
admission or final freshness checks.
Only `status: "prepared"` with a dispatch payload authorizes dispatch. Pass identical authenticated
`common` evidence to all selected axes in one background wave; preparation
failures are input blocks. Browser captures and diagnostics must claim a fresh
evidence root and retain actual command-close and restoration receipts. Missing
observation or watcher timeout never proves PASS or failure.

## Decision loop and recovery

1. Run `plan` (or `plan-all`) using fresh observations.
2. Execute exactly the returned action. Independent ready issues may run in
   parallel worktrees; selected review axes dispatch as one background batch.
3. Validate and record outcomes through the CLI. A child `ok: true` is
   completion telemetry, not a replacement for contract/head-bound evidence.
4. Run `plan` again until every issue is observably done or has a typed
   blocker requiring a decision.

Before retrying a failed child, clearing a blocker, or recovering observations,
read [operations.md](references/operations.md#decision-loop-and-recovery).
Apply the imported retry policy and preserve issue/branch/worktree/PR identity.
Required failed GitHub observations authorize no stage action. Dependencies
release only from fresh closed-issue observations. Subscribe through a host
monitor to `watch` and to `gh pr checks --watch` for CI; do not poll or create
a waiting child. Use `GH_PAGER=cat` in monitor commands.

## Integration coordination

Before handling overlap, conflict or generated inputs, read
[integration.md](references/integration.md). It owns marker opt-in, readiness
grants and occupancy, merged-sibling ancestry, and generated integration
evidence. Legacy lanes without `preflight_overlap` retain their old decisions,
observation and save behavior; never backfill them. Unrelated base movement does
not require integration. Every integration head needs fresh focused checks,
fresh required reviews (with any authenticated retention) and full exact-head remote CI.

## Retrospective capture and lane completion

Read [retrospective.md](references/retrospective.md) when starting or resuming
execution, recording measurements or incidents, and completing the lane.
Retain original reviewer and unsuccessful implementer returns before retry or
adjudication. Use `plan-all --with-retro` for completion: all issues done ends
execution, but the handoff includes one aggregate retrospective. Incident data
stays outside execution ledgers and supplies no passing gate or authority.
Applying recommendations requires separate scoped work.

## Local and remote gates

Before registering or judging a common baseline, read
[known-baseline.md](references/known-baseline.md). Admission and fresh
applicability checks authenticate exact-head committed source, conditions,
test bytes, failure/companion receipts and lead adjudication. Applicable
failures require fix-back; insufficient or different evidence blocks publication.
A baseline does not authorize scope expansion, automatic integration or reuse of
old-head checks.

Public consumer-visible package changes require a Changeset before review.
Package-root README/LICENSE files ship too; unrelated root docs do not imply
package release impact. Use the release governance contract.

Follow [Production Input Declarations](../../../docs/contracts/release-governance.md#production-input-declarations):
the issue head and comparison base supply the central declaration and producer
freshness evidence. Production inputs, including root/tooling/sibling consumers,
precede test/fixture names and nonshipping rules. Package/build owners maintain
input completeness and refresh changed command/producer/config evidence; unknown,
stale or missing old-base evidence cannot justify exclusion. See
[operations.md](references/operations.md#declared-production-inputs).

Focused checks must exercise the changed behavior and meet preflight criteria;
retain their commands, results and real-surface evidence for exact-head review.
For changes affecting CI Node concurrency, the lead completes the selected
original `pnpm test:node` before reviewer dispatch and includes it in the
existing `required_checks`/`evidence` inventory. Missing or stale receipts
require input preparation; unresolved current-head failures require diagnosis
and applicable fix-back, not a replacement review PASS.
Full local CI is not an automatic publication prerequisite for any approved
change, including CI/configuration, manifests and lockfiles. It remains
available for explicitly requested reproduction or diagnosis. Report omitted
full local CI as not run, never as PASS; do not create a receipt or local-check
fact for omission. A current recorded local failure
still blocks progress; never manufacture a passing receipt to bypass it.

Full local CI runs only after selected review PASS at the current head. Its checks,
build ordering, scope, and receipt rules live in `verify-local`. Verification
must never run concurrently with a child writing the same worktree. A new head
or accepted contract invalidates earlier evidence.

Before merge, require current-head focused checks and selected review, green current-head
remote CI, an explicit `MERGEABLE` state, and a merge grant. `UNKNOWN`
mergeability waits; a real conflict resolves on a new head and repeats focused
checks, reviews and the applicable CI gates. Advancing main alone does not mandate merging it into the issue
branch. Publishing stays GitHub Actions and Changesets only. The lead owns
merge and cleanup, never a stage reviewer.

### Optional full-local-CI omission audit

When retaining an explicitly instructed omission audit, read
[local-ci-waiver.md](references/local-ci-waiver.md) before registration.
It is optional assertion evidence after selected review PASS, never proof of
execution or a publication prerequisite. Do not infer instruction, create a
passing receipt for omission, or clear applicable local failures. All other
focused, review, remote CI, mergeability and authority gates remain required.

For conflicts, preserve both intended behaviors and return the resolved new
head through focused checks, review and the applicable CI gates. Do not reuse old approvals by claiming the
patch is equivalent. The sole exception is CLI-authenticated retention, which
keeps original reviewer heads and requires a fresh contract review. It never
carries local-check/waiver or remote CI evidence to the new head. Keep conflict
resolution inside the existing identity.

After observed merge, clean the issue and review worktrees and branches under
the existing grant, record cleanup, and cancel issue children. Keep reviewer
sessions available for readjudication until the issue is done; implementation
children can be retired once their output is verified. No session identity is
needed to resume the lane from persisted facts and live observations.

## Verification

```text
node --test .agents/skills/execute-lane/scripts/*.test.mjs
```
