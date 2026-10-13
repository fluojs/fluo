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

The v2 ledger supplies the lane id, base, confirmed issues, dependencies, and
merge grant. Its source path and byte digest remain provenance. External
issue dependencies are rejected. Read predicted conflicts before dispatch.
Hand-initialized lanes need an explicit merge grant; importing a ledger does
not authorize expanding its issue set.

## Canonical order

```text
preflight -> implement + focused tests -> selected exact-head reviews
                                      <- fix-back if review blocks
          -> verify-local only for explicitly requested full local reproduction
          -> create-pr / push -> full remote CI
                                    <- fix-back if CI fails
          -> merge authority + mergeability gate -> merge -> cleanup -> done
```

Every new implementation or conflict-resolution head repeats the selected
reviews after focused checks. All approved changes, including CI execution,
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
local CI runs only for explicitly requested reproduction or diagnosis.
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

### Workflow input preparation

`scripts/workflow-preparation.mjs` is the runnable preparation entry, not
another orchestrator. Before the preflight child, run its `preflight` mode and
pass the authenticated source-footprint sidecar into that stage. After the
existing engine returns `review`, materialize the exact-head checkout and run
its `review` mode with fresh observations, complete authored diff and the
accepted focused-evidence inventory. The schemas and artifact references live
in `../issue-preflight/SKILL.md` and `../review-head/SKILL.md`; executable
validation lives in the preparation source. Reuse the accepted contract and
canonical `obs.preflightPolicy`; do not alter engine actions or ledgers.

Only `status:"prepared"` supplies a dispatch payload. Pass its identical
`common` input to all returned reviewer axes in one background wave.
`kind:"input-preparation"` is an input block, not a reviewer BLOCK or an
implementation fix-back. Correct missing/stale evidence or re-open preflight
for real scope expansion. Independent issue worktrees and their review waves
remain parallel.

For browser reproduction use the existing
`node tooling/ci/react-product-acceptance.mjs capture tooling <absolute-new-output>`
entry. CI and local capture consume the same `productDomainPlan`, package-local
runner/config and prepared normal/form entries. Preserve seed/actions, evidence
paths, original suite coverage, assertions, retries and timeouts. Subscribe
through the host monitor with `persistent:true` until command close, descendant
cleanup and normal deployment restoration. Repository code declares this host
observer requirement; it does not modify workstation monitor defaults.
Observer timeout is missing observation, never a test verdict. Retain failed
and cancelled receipts and restoration results as well as successful ones.

Canonical captures and isolated diagnostics must claim a fresh evidence root
before any affected command spawns. A root with artifacts or an existing owner
marker is rejected without changing its bytes. Child directories inside the
owning canonical run are permitted; an isolated diagnosis never reuses that run.
The existing owned runners retain separate complete stdout/stderr, the combined
log, command metadata and actual close/cancellation state. Their terminal output
is a bounded reference to the retained command receipt, not the raw stream.
Do not rerun a completed command merely to recover clipped terminal output.
The prepared reviewer input includes one identical readable, authenticated index
of actual focused results and packed command/report metadata for every axis.

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

## Retrospective capture and lane completion

### Generated consumer integration coordination

`plan`, `plan-all` and `watch` share fresh lane-wide observations. For an actual
`CONFLICTING` PR at the local head, a generated-consumer hint can defer integration
with `wait-generated-integration` while a related sibling is independently ready
to merge. The decision lists exact sibling heads and PRs. Finish those merges,
then observe again before resolving the conflict once. A missing/stale review,
pending/failing CI, unknown mergeability or missing merge authority does not make
a sibling ready. Readiness loss, a completed merge or restart releases/recomputes
the wait; no persisted dependency or waiting lock is created. Implementation
remains parallel. Hints and unrelated main advancement never force integration.
An already reviewed mergeable head with CI running remains `wait-ci`.

The accepted base stays pinned and must remain an ancestor of both current issue
head and observed base; scope remains current merge-base-to-head. Incorporating
changed generated inputs requires new-head integration evidence, not base-SHA
freshness. Record `resolve-conflict` with current `head_sha` and
`generated_integration: { head, outputs, checks }`. Each output binds its surface,
canonical read-only generation command, exit code, expected-path and artifact
digests, and explicit `normalizeSourceFingerprint` choice. Expected files and
focused/browser raw-log receipts live in the issue worktree's disposable
`.omo/generated-integration/` harness. Admission executes authoritative
generation checking and verifies whole-file byte equality, normalizing only
sourceFingerprint values when required. Every focused/browser receipt binds the
new head and raw log digest. Missing, stale or tampered evidence fails closed.
All selected exact-head reviews and full exact-head GitHub CI must then run again;
old-head PASS, CI or patch-equivalence claims do not carry forward.

For measurements, `record --result-json` accepts optional `measurements` work
units with `{ runId, attempt, stage, head, clock, elapsedMs, scope }`. Stages are
`integration`, `focused`, `browser`, `review:contract`, `review:code`,
`review:verification`, or `ci`; scope is `stage-execution`. Measure actual work
with a monotonic clock, retain unique run/attempt identities, and use
`clock: simulation` only for event fixtures. Unknown durations are null, not zero.
Planning/watch observations separately retain process identity and monotonic
observation times. The retrospective reader computes head-specific stage counts,
superseded validation heads and separate dependency/coordination observed waits;
a restart without an observed wait end remains unknown. Neither `recordedAt`
nor simulation timing proves elapsed execution or a CI budget. Compare identical
initial state, changes, merge/CI schedule, final source and gate coverage, and
report worse or inconclusive outcomes without reducing checks, retries or timeouts.

Read `../retrospective-lane/SKILL.md` when starting or resuming execution. The lead
retains individual reviewer responses before aggregation/adjudication and
unsuccessful implementer returns before retry using `retro-record`. Keep task,
head, model, failed command and actual receipt/log references when available.
Record reproduction/adjudication separately: a reported BLOCK is not proof of
an implementation defect. Success must not overwrite the original incident.

The CLI retains `record` outcomes and review `set-fact` inputs outside the lane
ledger. CI failures are captured by actual run/attempt/job identity. Call
`retro-ci` on a failure notification before fix-back; merge/fix-back recording
and CI watch transitions also capture history. Missing API evidence becomes an
explicit collection gap, never a passing gate or an absent-failure claim.

All CLI `gh` observations run with `GH_PAGER=cat`. Before retrospective dispatch,
fresh PR observations include final-head applicable run/attempt identities.
`collect-ci` / `input-preparation` means retain/recollect the missing final CI
events and refresh observations; it is not product failure or implementation
fix-back. Earlier-head success, earlier attempts and incomplete job collection
cannot unblock dispatch. Older failures remain immutable after recollection.

Use `plan-all --with-retro` for the completion handoff. It preserves the issue
decisions but reports `settled: false` and a `retrospective.action: retro`
until the completed merge set has its report. The legacy `plan-all` array
remains an execution-only interface, not a retrospective completion verdict.
When fresh issue decisions are all `done`, execution is finished but the
completion handoff still includes the one aggregate retrospective. `watch`
emits `RETRO-READY` at that boundary. Follow the retrospective skill's
`retro-plan -> retro-evidence -> fluo-retrospective -> retro-report` flow, then
return the report and strongest evidence-backed improvement proposals.
Repeated observations of the same completed merge set reuse the report.
Legacy execution ledgers remain unchanged and completed issues never reopen
for analysis; missing older history is reported as partial coverage.

Recommendations do not automatically change workflow, tests, skills, rules,
models, or remote state. Applying them is separate scoped work. All incident
data and reports live in `.omo/retros/`, outside disposable issue worktrees
and separate from `.omo/lanes/` and `.omo/lanes-v4/`.

## Local and remote gates

### Authenticated known baseline before publication

The lead may register a confirmed common baseline only for explicitly related
lane issues with `set-fact --kind known-baseline --issue <related-issue> --value
'<record-json>'`. `scripts/known-baseline.mjs` authenticates version 1 records:
`{version,id,issues,failure,companion,adjudication}`. Both checks bind
`{head,command,sources,conditions,test_source,log,receipt}`; file references are
`{path,sha256}`. Sources, immutable conditions and test source name committed
bytes at each exact head. Logs and receipts name nonempty artifacts under the
observation root. Receipts bind
`{version,head,command,completed,signal,status,exit_code,log_sha256,source_sha256}`.
`source_sha256` hashes `JSON.stringify({sources,conditions,test_source})`.
The completed failure has a positive exit code; the companion has exit code 0.
Both use the same command, conditions and unchanged test source. A companion
changes related source, not assertions, scope, retries or timeouts.

Adjudication is `{authority:"lead",cause:"confirmed-common-baseline",
failure_head,companion_head,reason}` bound to both checks. Reviewer claims,
UNKNOWN causes, watcher timeouts and historical retrospective event labels
are not admission evidence. Invalid admission leaves the lane file unchanged.
The README companion example requires actually running
`pnpm vitest run tooling/governance/runtime-matrix-docs-contract.test.ts`
at the companion checkout and retaining all 17 PASS results with command,
head, test-source and raw-log digest binding.

Fresh publication observation reauthenticates admitted artifacts and compares
current committed source, conditions and test bytes. It returns `still-failing`,
`fixed`, `different-source-or-conditions` or `insufficient-evidence` with exact
comparison evidence. Missing or altered admitted proof blocks preparation;
it is never silently treated as no record. An applicable identical failure
returns canonical `fix-back` in the existing branch/worktree/PR. Different or
insufficient evidence blocks publication for lead adjudication. No record,
unconfirmed siblings and unrelated main advances add no integration requirement.
This observation neither executes tests nor automatically integrates a companion.

Companion application stays inside the accepted preflight and ownership boundary;
scope expansion returns to preflight. The approved base stays pinned. A changed
head requires affected focused checks and new selected exact-head reviews before
creating or pushing the same PR; earlier review, local evidence and remote CI PASS
do not transfer. Merge still requires full exact-head canonical GitHub CI,
mergeability and authority. Independent implementation, review and CI stay
parallel; this gate does not serialize branches or impose automatic full local CI.

Public consumer-visible package changes require a Changeset before review.
Package-root README/LICENSE files ship too; unrelated root docs do not imply
package release impact. Use the release governance contract.

Focused checks must exercise the changed behavior and meet preflight criteria;
retain their commands, results and real-surface evidence for exact-head review.
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

When the operator has explicitly instructed the lane not to run full local CI,
the lead may retain that existing instruction through `local-ci-waiver` after
every selected review passes at the current head. Do not infer authority from
preflight prose, automatically create a waiver, or run a prohibited verifier to
produce a receipt. This is optional audit evidence, not a publication gate:
no change requires a waiver to omit full local CI. The fact never proves execution;
focused checks, preflight, scope, dependencies, Changesets, review, remote
head equality, full remote CI, mergeability and merge authority still apply.
An applicable local failure, including failed receipt revalidation, still
requires fix-back. Registration neither clears failures nor resets attempts or
blockers.

Use fresh `plan` observations and `localCheckBinding(obs.review,
obs.reviewAcceptedAt)` from `scripts/lane-v4.mjs`. Supply exactly:

```text
{
  laneId, issue, status: "waived", scope: "full-local-ci",
  preflightSha256, reviewSha256, reviewAcceptedAt,
  authority: "explicit-operator-instruction",
  evidence: {
    kind: "accepted-preflight",
    contractSha256,
    criteria: ["A12", "V12", "SE-V05"]
  }
}
```

The three binding fields come from `localCheckBinding`: `preflightSha256` is
the effective review policy digest, not the accepted contract digest.
`evidence.contractSha256` is `obs.preflight.sha256`, the canonical accepted
artifact digest. `criteria` contains nonempty, distinct criterion references
for the already accepted instruction; the identifiers above illustrate such
references, not automatic authorization or a prose-matching rule.

```text
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs set-fact --root . --lane <lane.json> --issue <n> --kind local-ci-waiver --head <current-head> --value '<waiver-json>'
```

The CLI re-observes head, contract, effective policy and selected review PASS,
then rejects stale caller bindings instead of rebinding them. It stores
`{ head, accepted_at, value }` in `facts["local-ci-waiver"]` and exposes that
wrapper as `obs.localCiWaiver`, separately from `obs.localChecks`.
`accepted_at` records the assertion time only. Receipt fields, `status:
"passed"`, `valid: true`, execution timestamps and unknown keys are rejected.
A waived gate must be reported as waived, never as passed or executed.

Head, lane/issue, contract, policy, review content or review acceptance changes
invalidate the waiver. Replacing preflight or review clears it alongside local
checks; identical accepted preflight re-registration preserves those facts.
An unrelated main advance preserves the pinned valid ancestor and binding.
A new head needs all selected reviews; retaining the optional audit fact on that
head requires explicit registration under the still-applicable operator
instruction. The audit binding is never carried forward automatically.
Remote rollup handling is unchanged: this audit fact does not
prove a required check count or replace the lead's complete remote-CI evidence.

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
