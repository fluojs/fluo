---
name: search-issue
description: Evidence-backed Fluo package issue discovery invoked with leading $search-issue. Asks for package scope and audit purposes, runs native reviewer tasks in parallel, maintains one shared ledger, drafts and triages issues, automatically registers approved drafts under explicit harness authority, and emits the create-lane handoff.
---

# Search issue

Use this skill only inside the Fluo repository. It is the native OMO workflow
for package issue discovery, draft triage, authorized registration, and
create-lane handoff.

## Intake

Resolve intake in three ordered steps. Every choice shown to the user includes
a visible Korean name, a selection number, and its canonical slug. Accept any of
those forms; never ask the user to remember or enter an unexplained internal ID.

### 1. Ask only for the target mode

Present these choices before asking for package names or purposes:

1. 전체 패키지 대상
2. 특정 패키지군 대상
3. 특정 패키지 대상

Use a registered structured selection tool when the runtime actually exposes
one. Use single-select for this question. The current OMO runtime may not expose
`ask_question`; never claim that it exists or attempt to call an unavailable
tool. Fall back to the numbered plain-text choices above.

### 2. Resolve the package scope

- For `전체 패키지 대상`, resolve every package without a follow-up.
- For `특정 패키지군 대상` or `특정 패키지 대상`, run
  `node .agents/skills/search-issue/scripts/intake.mjs packages`. Tool output is
  not user-facing presentation because OMO may collapse it. Copy the complete
  stdout table, including every row, into the response immediately before the
  selection question. Never replace the table with an ID-only bullet list. Then
  ask for one or more visible names, numbers, or slugs. Use multi-select when a
  structured selection tool is available; otherwise accept comma-separated
  text. If a bare token such as `cli` names both a group and package, ask the
  user to choose the displayed group or package option instead of guessing.
- Resolve the answer through
  `node .agents/skills/search-issue/scripts/intake.mjs resolve <mode> [selection...]`.

### 3. Ask for audit purposes

Run `node .agents/skills/search-issue/scripts/intake.mjs purposes`, show the
complete purpose table without truncation, and ask for one or more visible
purpose names, numbers, or slugs. Copy every stdout row into the response
immediately before the question; do not rely on collapsed tool output or
replace descriptions with an ID-only list. Resolve the answer with
`node .agents/skills/search-issue/scripts/intake.mjs resolve-purposes [selection...]`.
Use multi-select when available; otherwise accept comma-separated text.

Treat valid values supplied in the leading invocation as already answered and
continue at the first missing step. Do not create a goal or todo, write a
ledger, inspect package code, start reviewer tasks, or access GitHub until all
three intake steps are valid.

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

Do not use foreground or serial reviewer calls. If native background task
batching is unavailable, block the run instead of removing reviewer todos or
inventing reviewer results.

## Stop

Stop when every expected invocation and draft is terminal, all creation
receipts reconcile, the ledger is complete, and the artifact/handoff contract
is satisfied. Stop fail-closed with a named reason when intake, reviewer
results, triage, registration, or publication is incomplete.
