---
name: search-issue
description: Evidence-backed Fluo package issue discovery invoked with leading $search-issue. Asks for package scope and audit purposes, runs native reviewer tasks in parallel, maintains one shared ledger, drafts and triages issues, automatically registers approved drafts under explicit harness authority, and emits the create-lane handoff.
---

# Search issue

Use this skill only inside the Fluo repository. It is the native OMO workflow
for package issue discovery, draft triage, authorized registration, and
create-lane handoff.

## First action

Your first tool action must be one structured question call containing both the
package scope and audit-purpose questions. Do not read package files, create a
goal or todo, write a ledger, start tasks, or access GitHub before valid intake.

## Native assets

After intake, read only the assets in this skill package:

- `references/domain.json`
- `references/workflow.md`
- `references/reviewer-contract.schema.json`
- `references/reviewers/common.md`
- the specialist reviewer references selected by `domain.json`
- `references/reviewers/registration-triage.md` after draft creation

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
9. Publish the exact minimal search artifact and emit the native
   `$create-lane` handoff.

The lead is the only ledger writer and the only owner of GitHub mutations.
Reviewers are independent and read-only, so do not create a persistent team for
ordinary package waves.

Do not use foreground or serial reviewer calls. If native background task
batching is unavailable, block the run instead of removing reviewer todos or
inventing reviewer results.

## Stop

Stop when every expected invocation and draft is terminal, all creation
receipts reconcile, the ledger is complete, and the artifact/handoff contract
is satisfied. Stop fail-closed with a named reason when intake, reviewer
results, triage, registration, or publication is incomplete.
