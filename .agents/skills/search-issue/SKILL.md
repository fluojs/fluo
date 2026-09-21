---
name: search-issue
description: Evidence-backed Fluo package issue discovery invoked with leading $search-issue. Asks for package scope and audit purposes, runs native reviewer tasks in parallel, maintains one shared ledger, drafts and triages issues, automatically registers approved drafts under explicit harness authority, and emits the create-lane handoff.
---

# Search issue

Use this skill only inside the Fluo repository. It is the native OMO workflow
for package issue discovery, draft triage, authorized registration, and
create-lane handoff.

## Intake

Intake is a directed graph of three ordered steps: target mode, package scope,
audit purposes. Ask each step as one structured question, wait for the returned
answer, and branch on it before the next step. Use the runtime's structured
question tool — `ask_user_question` in the current OMO runtime — for every
step: it renders options as selectable chips, supports multi-select, and
returns the answer as the tool result. Only the lead may call it; never
delegate intake to a subagent. The tool accepts at most four questions per
call and four options per question, so split a larger catalog across questions
of one call, or — only when one call cannot hold it — across consecutive
calls, offering every entry exactly once. When the runtime does not expose the
tool, use the numbered plain-text fallback of each step instead of claiming or
calling an unavailable tool.

Every option shows a visible Korean name where the catalog defines one, with
the canonical slug in its description; never ask the user to remember or enter
an unexplained internal ID. Selected labels and slugs are accepted resolve
tokens, so the structured path needs no selection numbers.

### 1. Ask only for the target mode

Build one single-select question from
`node .agents/skills/search-issue/scripts/intake.mjs modes`: the mode's Korean
label is the option label and its catalog description is the option
description:

1. 전체 패키지
2. 특정 패키지군
3. 특정 패키지

Fallback: show the numbered plain-text choices above and accept a visible
name, number, or slug.

### 2. Resolve the package scope

- For `전체 패키지`, resolve every package without a follow-up.
- For `특정 패키지군`, run
  `node .agents/skills/search-issue/scripts/intake.mjs packages` and present
  every group as multi-select chips in one call, split across questions of at
  most four options each; the Korean group name is the label and the group
  description plus member packages form the description.
- For `특정 패키지`, present every package as multi-select chips paginated over
  consecutive calls of at most sixteen options each until every package has
  been offered exactly once; the public `@fluojs/*` name is the label and the
  owning group name is the description.
- On the structured path the populated option descriptions are the
  user-facing presentation, so echoing the stdout table is not required. On
  the fallback, tool output is not user-facing presentation because OMO may
  collapse it: copy the complete stdout table, including every row, into the
  response immediately before the question, never replace it with an ID-only
  bullet list, and accept comma-separated visible names, numbers, or slugs.
  If a bare token such as `cli` names both a group and package, ask the user
  to choose the displayed group or package option instead of guessing.
- Resolve the answer through
  `node .agents/skills/search-issue/scripts/intake.mjs resolve <mode> [selection...]`,
  passing the selected labels or slugs — the union across that step's
  questions — as the selections.

### 3. Ask for audit purposes

Run `node .agents/skills/search-issue/scripts/intake.mjs purposes` and present
every purpose as multi-select chips in one call, split across questions of at
most four options each; the Korean purpose name is the label and the purpose
description plus its reviewer slugs form the description. Resolve the answer
with `node .agents/skills/search-issue/scripts/intake.mjs resolve-purposes [selection...]`,
passing the union of selected labels or slugs.
Fallback: show the complete purpose table without truncation in the response
and accept comma-separated visible names, numbers, or slugs.

### Structured asking rules

- Wait for the returned answer before starting the next step.
- On a timeout result, re-ask that step once; on a second timeout, stop
  fail-closed before any state creation.
- Treat valid values supplied in the leading invocation as already answered and
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
