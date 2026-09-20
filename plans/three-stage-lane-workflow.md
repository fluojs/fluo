# Native Three-Stage Lane Workflow

## Status and pipeline

The active top-level workflow is discovery, planning, then execution:

```text
$search-issue
$create-lane .omo/search-issue/artifacts/<search_run_id>.json
$execute-lane .omo/lanes/<lane_id>.json
```

| Stage | Active contract | Responsibility |
| --- | --- | --- |
| Search | .agents/skills/search-issue/SKILL.md | Evidence-backed discovery and approved issue registration |
| Create | .agents/skills/create-lane/SKILL.md | Artifact, bulk issue, or verbal intake into one provenance-bound lane |
| Execute | .agents/skills/execute-lane/SKILL.md | Sole decision loop over lane intent and fresh git/GitHub observations |

Create-lane owns intake normalization, optional recommendation, dependency
planning, authority, and atomic v2 ledger publication. Its skill is the
normative planning contract; execution does not introduce another approval or
planning workflow. Search artifacts live under .omo/search-issue/artifacts/;
planning ledgers live under .omo/lanes/.

## Execution stages

1. **issue-preflight** reads the issue and governing sources, then fixes scope,
   non-goals, acceptance criteria, verification criteria, and review policy.
2. **issue-implement** produces a local commit and focused regression evidence.
   Fix-back reuses that contract and the existing branch/worktree/optional PR.
3. **review-head** runs selected reviewers against the exact head and accepted
   contract. Blockers return to implementation, then selected-axis re-review.
4. **verify-local** runs local CI only after review passes. Failure returns to
   implementation; a new head must pass review again before rerunning local CI.
5. **sync-pr** creates or updates the single PR only after both gates pass.
6. **execute-lane** subscribes to remote CI, handles conflicts and retries,
   checks merge authority and mergeability, merges, and cleans up.

Review policy is selective: explanatory docs require contract review;
standalone tests/fixtures require code and verification; runtime/API, mixed,
unknown, workflow instructions, and governance require all three axes.
Preflight records omissions with reasons. The lead independently captures the
actual diff, adds newly needed axes, and returns out-of-scope changes to
preflight. Implementers cannot shrink review scope. Missing, malformed,
duplicate, or stale envelopes never become PASS.

Verification reviewers inspect test adequacy and focused implementation
results. They do not run local CI and do not demand its later receipt as a
review prerequisite. Same-head review and post-review local CI are separate
facts. Both must be current before publication.

## State, resume, and authority

The v4 CLI imports a v2 planning ledger into .omo/lanes-v4/. It observes live
branch, worktree, PR, checks, and issue state on every plan. Preflight and
contract/head-bound facts are persisted, while task/goal/todo state is only a
projection. A different coordinator can resume without a DAG or session ID.
Historical schemas are retained for historical artifact validation, not loaded
as a second execution protocol.

Dependencies release from live upstream issue closure. Independent eligible
issues use separate worktrees and background tasks; selected reviewers form
one parallel batch. No DAG/supervisor graph is constructed.

Only the lead owns shared state and remote writes. Reviewers remain read-only;
implementers stay inside assigned worktrees. Merge requires same-head review,
local and remote CI, mergeability, and the lane grant. Cleanup follows observed
merge. Publishing remains Changesets plus GitHub Actions only.

## Validation

Run the engine's Node tests and the stage/manifest governance suites listed in
.agents/VALIDATION.md. Exercise the real CLI with isolated git/GitHub fixtures,
including preflight, selective review, scope expansion, fix-back, post-review
local CI, publication gates, stale evidence, and resume. Synthetic fixtures do
not confer live side-effect authority.
