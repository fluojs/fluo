---
name: search-issue
description: Evidence-backed Fluo package issue discovery invoked with leading $search-issue. Asks for package scope and audit purposes, runs native reviewer tasks in parallel, maintains one shared ledger, drafts and triages issues, automatically registers approved drafts under explicit harness authority, and emits the create-lane handoff.
---

# Search issue

Use this skill only inside the Fluo repository. It is the native OMO workflow
for package issue discovery, draft triage, authorized registration, and
create-lane handoff.

## Intake

Before repository discovery, state creation or GitHub access, read and follow
[references/workflow.md#Intake](references/workflow.md#intake), the single intake
contract.

## Native assets

After intake, read only the assets in this skill package:

- `references/domain.json`
- `references/workflow.md`
- `references/reviewer-contract.schema.json`
- `references/reviewers/common.md`
- the specialist reviewer references selected by `domain.json`
- `references/reviewers/registration-triage.md` after draft creation
- `scripts/intake.mjs` for target choices, catalogs, and scope resolution

Do not load legacy OpenCode commands, skills, agents, permission blocks, or
runtime paths. They are not dependencies of this workflow.

## Orchestration

Follow `references/workflow.md` end to end:

1. Resolve one immutable package scope.
2. Register one native goal and a lead-owned common ledger.
3. Mirror stable invocation IDs into native todo.
4. Dispatch package/reviewer pairs through one background native `task` batch
   per parallel wave.
5. Validate and aggregate typed reviewer envelopes.
6. Deduplicate findings and create stable issue drafts.
7. Run one read-only registration-triage task.
8. Automatically register only approved drafts when explicit harness authority
   is present and investigation-only mode is false.
9. Publish the canonical v2 search artifact under
   `.omo/search-issue/artifacts/` and emit the native `$create-lane` handoff.
   Never emit or maintain an active `.opencode` handoff.

The lead is the only ledger writer and the only owner of GitHub mutations.
Reviewers are independent and read-only, so do not create a persistent team for
ordinary package waves.

Use `scripts/run.mjs` for every real ledger transition and registration;
never hand-write a ledger or call `gh issue create` separately. Initialize with
`init --input <intake.json> --root <repository> --out <run-directory>`.
The input contains `run_id`, `repository` (`owner/repo`), `authority`, and
`intake` (`scope_mode`, `packages`, `purposes`). See `references/workflow.md`
for start, collect, drafts, triage, register, publish, block, and resume.
Every command validates `references/run-ledger.schema.json` and the invocation,
draft, and receipt invariants before advancing.

`run-scenario.mjs --fixture-only` adapts synthetic task results and issue numbers
at the fixture boundary, then uses the same construction, validation, drafting,
and registration transitions. Production input rejects those fields.

Do not use foreground or serial reviewer calls. If native background task
batching is unavailable, block the run instead of removing reviewer todos or
inventing reviewer results.

## Package labels

`references/domain.json` owns the package groups and label allowlist.
Each package belongs to exactly one group: its group label is
`area:<group-slug>` and its individual label is `pkg:<package-slug>`
(for example, `area:ui` and `pkg:react`, not `pkg:@fluojs/react`).
Use the catalog's groups rather than inferring them from package names.

Every issue draft and registering triage decision must retain both labels
for each affected package. Bundled drafts use the union of affected package
labels and their owning group labels, not the entire audit scope. Keep
priority, issue type, and `source:package-audit` labels alongside them.
Before registration, confirm required labels exist on GitHub; missing labels
block registration rather than being silently omitted.

## Stop

Stop when every expected invocation and draft is terminal, all creation
receipts reconcile, the ledger is complete, and the artifact/handoff contract
is satisfied. Stop fail-closed with a named reason when intake, reviewer
results, triage, registration, or publication is incomplete.

On interruption, use `run.mjs block --reason <reason>` with the same root and
run directory. Continue through `run.mjs resume`; neither command completes
unfinished native invocations or discards terminal results and receipts.
