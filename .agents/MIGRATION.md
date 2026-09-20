# OMO+Senpi workflow migration

## Active workflow

```text
search-issue -> create-lane -> execute-lane
                              preflight -> implement -> selected review
                              -> local CI -> PR -> remote CI -> merge -> cleanup
```

The execution stages are `issue-preflight`, `issue-implement`,
`review-head`, `verify-local`, and `sync-pr`. They return one bounded
result to `execute-lane`. The previous issue-to-pr and pr-to-merge entrypoints
are retired, not retained as alternate orchestration paths.

## State and authority

- Planning provenance: `.omo/search-issue/artifacts/` and `.omo/lanes/`.
- Execution intent and contract/head-bound facts: `.omo/lanes-v4/`.
- Current branch, worktree, PR, checks, and merge state: fresh git/GitHub.
- Only the lead persists shared execution state and performs remote writes.
- Children implement or review one assignment; goal/todo state is a projection.

No DAG bindings, parent-session identities, supervisor stores, event chains,
or leases are prerequisites for v4 execution. Historical shared schemas remain
available to validate historical artifacts; they are not active execution inputs.

## Cutover

1. Stop dispatch through retired entrypoints; retain existing git/GitHub work.
2. Import a ready v2 lane with `init --from-lane-v2`. Do not rewrite planning
   evidence or reset active branch/PR identities.
3. Run `plan` against live observations. A lane without an accepted preflight
   must acquire one before further implementation/review/publication.
4. Reconcile actual diff and collect selected-axis reviews bound to the new
   contract and current head, then run local CI before publication.
5. Resume the normal decision loop. Legacy reviewer verdicts are not approval
   under the new selective-review contract.

Legacy OpenCode assets remain read-only under `.opencode-backup/` and are
never a runtime fallback. The explicit search-artifact importer may read archive
inputs only during an authorized migration:

```text
node .agents/skills/search-issue/scripts/migrate-legacy-artifacts.mjs --source .opencode-backup/search-issue --target .omo/search-issue/artifacts/legacy --migrated-at 2026-08-24T00:00:00.000Z
```

Rollback of tooling never silently undoes issues, PRs, or merges. Reconcile those
from GitHub before resuming with another tooling revision.
