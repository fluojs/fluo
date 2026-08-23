# Native `$search-issue` workflow

This workflow owns discovery through issue registration and handoff. The common
run ledger is authoritative; native goal and todo state are user-facing
projections of it.

## Intake

The first tool action is one structured question call containing:

1. package scope: direct packages, one package group, or all public packages
2. one or more purposes from `domain.json`

Ask one immediate follow-up only when direct package names or the group name are
missing. Empty, cancelled, or unsupported answers stop before repository
discovery, goal creation, todo creation, ledger creation, reviewer tasks, or
GitHub access.

An explicit leading `$search-issue` invocation records
`explicit_harness_invocation: true`. If the user explicitly requests
investigation only, also record `investigation_only: true`; otherwise it is
false and triage-approved drafts are automatically registered.

## Scope and ledger

After valid intake:

1. Read `domain.json`.
2. Resolve public package names and group membership once.
3. Never expand the immutable package list later.
4. Create a run goal containing scope, purposes, read-only reviewer boundary,
   registration authority, and create-lane non-goals.
5. Create the full ledger under
   `.omo/search-issue/runs/<run-id>/ledger.json`.
6. Mirror each expected invocation into native todo using the stable key
   `package:<package>/reviewer:<reviewer>`.

Use `read`, repository listing tools, or `git ls-files` for preflight evidence
discovery. Do not use `find`, `xargs`, broad shell pipelines, redirection, or
`-exec`.

The ledger states are `intake`, `running`, `triage`, `registering`,
`published`, `completed`, and `blocked`. Each invocation transitions from
`expected` to `started` to `completed`, `failed`, or `blocked`.

## Native reviewer waves

Build the reviewer set by taking the ordered union of selected purpose routes
from `domain.json`. Create one task per package/reviewer pair.

- Read `reviewers/common.md` and the selected specialist reference.
- Route with the native task category from `domain.json`.
- Use a self-contained prompt with `TASK`, `DELIVERABLE`, `SCOPE`, `VERIFY`,
  and `STOP WHEN`.
- Dispatch each wave through exactly one native `task` batch call containing
  every independent invocation in that wave, with `run_in_background: true`.
  Do not call reviewers in the foreground or serially.
- Wait for every task in one wave to become terminal before starting another.
- Reviewers return typed JSON and never write the ledger.

The lead validates every result against `reviewer-contract.schema.json` and
reconciles expected versus completed invocation IDs. Missing or malformed
results block finding intake.

If the native `task` tool or background batch mode is unavailable, mark the run
`blocked` and stop. Never delete, skip, complete, or synthesize an invocation
without its returned native task ID and terminal typed envelope.

## Finding intake and drafts

Keep `audit_finding` and `rd_brief` records separate. Deduplicate findings by
package, evidence, problem theme, contract impact, and affected surfaces.
Compare viable drafts with open GitHub issues before triage.

Default to one issue draft per package. Bundle packages only when root cause,
fix theme, contract impact, and ownership are identical. Assign stable draft
IDs `D1`, `D2`, and so on in immutable scope order.

Draft bodies contain:

- context and selected audit purposes
- evidence-backed findings or eligible feature briefs
- contract impact and affected surfaces
- preserve-contract resolution direction
- affected packages
- why the issue should be acted on now

## Registration triage

After all drafts are stable, run exactly one native task using
`reviewers/registration-triage.md`. It returns one `register`, `defer`, or
`reject` decision for every draft.

The triage task is read-only. The lead alone owns registration:

- require explicit harness authority
- skip all registration in investigation-only mode
- register only `register` decisions
- reject labels outside `domain.json`
- never publicly register security-sensitive or support-only drafts
- execute `gh issue create` once per approved draft and record the exact
  issue number and URL in the ledger
- stop on the first failed or malformed creation receipt

## Publication and handoff

When at least one issue is created, call:

```text
node .agents/skills/search-issue/scripts/publish-search-artifact.mjs \
  --root <primary-repository-root> \
  --run-id <search-run-id> \
  --issues <comma-separated-created-issue-numbers>
```

The helper validates a safe run ID, unique positive issue numbers, repository
containment, symlink safety, and exclusive same-filesystem publication. It
creates exactly:

```json
{
  "version": 1,
  "search_run_id": "search-run-id",
  "selected_issues": [4101]
}
```

Emit `$create-lane .omo/search-issue/<run-id>.json main`.

When zero issues are created, create no search artifact and report
`search_run_id: none`.

## Final report

Report scope, purposes, invocation counts, P0/P1/P2 findings, feature briefs,
dedupe results, draft mappings, triage counts, registered/deferred/rejected
issues, artifact path or `none`, and the native `$create-lane` handoff.
