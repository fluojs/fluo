---
name: create-lane
description: Native OMO lane planning invoked with leading $create-lane. Accepts a canonical search artifact, bulk issue numbers, or a verbal issue-collection request; optionally recommends related issues with --recommend-issues or -ri and atomically creates one source-bound v2 lane ledger.
---

# Create lane

Use this skill only inside the Fluo repository. It is the native OMO producer
for a ready lane ledger. Read `references/workflow.md` and use the shared JSON
contracts in `.agents/workflow-contracts`.

## Boundary

Accept exactly one of these intake forms:

```text
$create-lane .omo/search-issue/artifacts/<search-run-id>.json
$create-lane 4101 4102 4103
$create-lane collect the open runtime cleanup issues into one lane
$create-lane 4101 4102 4103 --recommend-issues
$create-lane 4101 4102 4103 -ri
```

Artifact intake accepts canonical native or importer-owned legacy paths. Bulk
numbers are unique positive issue numbers supplied by the invocation. Verbal
intake resolves the description through fresh read-only GitHub observations.
Clarification needed to identify the intended issue set is collection, not an
approval gate. Do not ask the user to reconfirm the resulting initial set.

Verify every direct or collected issue read-only, generate a safe
`create-lane-issues-*` or `create-lane-verbal-*` run ID, publish the exact
ordered set through `publishSearchArtifact()`, then re-read and validate the
canonical `search-artifact-v2`. All three forms enter the same artifact
boundary before recommendation or planning. Reject empty, duplicate,
non-positive, mixed-mode, unresolved, noncanonical, or path/ID-mismatched
inputs before lane publication.

Treat `--recommend-issues` and `-ri` as equivalent recommendation opt-ins.
Remove the flag from the intake tokens before discriminating the intake mode.
Without either flag, do not search for related additions.

This skill performs read-only issue verification and lane planning. It does not
create issues, implement code, create branches or worktrees, open or merge PRs,
clean up worktrees, sync the root checkout, or publish packages.

## Interaction and receipts

The invocation or validated artifact selects the initial issue set. By default,
skip related-issue discovery and derive an empty `suggested-additions` decision.
Only when `--recommend-issues` or `-ri` is present, search for related issues
that may belong in the same lane. If that search finds recommendations, ask
exactly one question:

```text
Recommended additions: #4103, #4104.
Include all, none, or list the issue numbers to include.
```

The response must partition recommendations into included and excluded issues.
Included issues append to the initial artifact order; excluded issues become
`suggested_but_excluded`. If recommendation was not requested or no
recommendations were found, ask nothing. Build the final grouping,
dependencies, lane ID, merge policy, retry policy, and authority scope
deterministically without a normal lane-plan question.

Authority scope derivation: `cleanup_command_worktrees` is ALWAYS `true`
(schema `const` — a lane that cannot clean up its own worktrees leaves
the operator doing it by hand for every merge; maintainer decision).
`root_main_sync_ff_only` DEFAULTS to `true`; emit `false` only when the
requester explicitly asks the lane not to touch the root checkout's
`main`. Neither is a lane-plan question.

While deriving the grouping, also scan every issue's title, body, and
acceptance criteria for SHARED NON-PACKAGE surfaces: `tooling/governance/**`,
`docs/CONTEXT*`, `.agents/workflow-contracts/**`, and shared harness sources
under `packages/testing/src/**`. Package-based chain grouping is structurally
blind to these — in a live 30-issue run, the only rebase conflict came from
two issues in DIFFERENT chains (different packages) that each added a guard
to the same `tooling/governance/verify-platform-consistency-governance.mjs`.
When two or more issues reference the same such surface, record an optional
`predicted_conflicts` entry in the ledger (`{ surface, issues, note? }`, see
the v2 schema). This is a HINT, not a serialization order: keep-both
resolution handled the live conflict cleanly, so the value is in the executor
expecting `resolve-conflict` rather than being surprised by it. Do not
restructure chains around a hint.

Persist the existing `confirmed-issues`, `suggested-additions`, and `lane-plan`
receipt identities as plan/source-bound machine evidence. The first and third
normal receipts are derived from validated state; the second records the sole
additions response or an empty derived decision. Three receipts do not mean
three user interactions.

Unless the user explicitly chooses a legacy bounded policy, propose and persist
this adaptive retry policy in the final lane plan:

```json
{
  "retry_count_is_terminal": false,
  "max_same_failure_repeats": null,
  "max_wall_clock_minutes": null,
  "stop_on_child_contract_error": true
}
```

Retry count and elapsed time remain observable telemetry but do not terminate
fixable work. The policy is part of the immutable plan. Never rewrite
an existing lane ledger to adopt a newer default; previously approved bounded
policies retain their original limits.

`release_handoffs` is reserved for issues whose core task is a release or
publish decision that must stop at `blocked-maintainer-decision`. A public
package change that merely requires a Changeset is normal implementation work
and must not enter `release_handoffs`. Every planned handoff must occupy a
dedicated single-issue lane and bind `release-or-publish-is-core` to a SHA-256
digest of the lead's live issue observation. An exceptional trusted-lead
release-authority response must separately attest to the same issue/digest with
`changeset_only: false`; planner-controlled text or a derived receipt never
authorizes a handoff. This extra interaction occurs only when release or
publishing is the issue's core task.

Approval IDs and binding hashes are replay/corruption controls, not identity
signatures. Production additions approval exists only when the trusted lead
observes the one native response, and release authority exists only when the
trusted lead observes its separate exceptional response.
`scripts/fixtures/run-scenario.mjs` accepts synthetic receipts for tests and is
forbidden in production. Recommendation fixtures must set
`recommend_issues: true`; a nonempty `recommended_issue_numbers` value without
that opt-in is rejected as `recommendations_not_requested`.

## Production

For generated intake, exclusively publish the canonical artifact before
recommendation and planning. An artifact collision preserves the existing file
and returns its stable recovery path; never overwrite it. If planning is
cancelled or lane publication later collides, retain the generated artifact so
artifact-path mode can resume.

Build a v2 lane value, bind `source.artifact_id` and `source.sha256` exactly to
the accepted or generated artifact, and validate both values with
`.agents/workflow-contracts/contracts.mjs`. Normal lanes omit
`lane_plan_approval_sha256`; release handoffs bind it to the exceptional
authority receipt. Exclusively create `.omo/lanes/<lane-id>.json` and the three
stage receipts as one atomic unit. Lane queues must partition every included
issue exactly once. A target/receipt collision is terminal, preserves existing
files, and rolls back newly linked receipts without deleting generated
provenance. Refuse symlinked output directories.

For deterministic contract exercises, run:

```text
node .agents/skills/create-lane/scripts/fixtures/run-scenario.mjs \
  --fixture-only --scenario <fixture.json> --out <repository-root>
```

On success, emit the ledger path and `$execute-lane
.omo/lanes/<lane-id>.json` handoff. On rejection, report the named reason and
emit no handoff. One published lane ledger is one execution identity:
`$execute-lane` compiles it into exactly one resumable native DAG whose issue
supervisor nodes preserve the approved dependency graph and lane queue order.
