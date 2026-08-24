# Native `$create-lane` workflow

The native producer turns one canonical search artifact into one ready v2 lane
ledger. The artifact and shared workflow contracts are authoritative.

## Intake

1. Accept exactly one direct path under `.omo/search-issue/artifacts/`, or one
   importer-owned path under `.omo/search-issue/artifacts/legacy/`.
2. Require the filename stem to equal `search_run_id`.
3. Validate `search-artifact-v2`, including recomputed canonical `artifact_id`
   and `sha256`, before asking for or recording a plan.
4. Reject mixed forms, archived `.opencode` paths, deeper or noncanonical
   artifact paths, malformed JSON, unknown keys, duplicate or empty issue sets,
   and path/ID mismatches without filesystem writes.

## Approval sequence

Show the artifact candidates and obtain three separate approvals:

1. Confirmed issues approval chooses the exact artifact issue set.
2. Suggested additions approval independently accepts additions; unapproved
   suggestions do not enter the lane.
3. Lane plan approval accepts the final grouping, dependency graph, release
   handoffs, merge/retry policy, authority scope, and lane identity.

Each gate has a distinct approval identity and interaction. Its digest binds
the complete plan and source artifact. Persist consumed IDs so missing, denied,
out-of-order, substituted, or replayed approvals stop before publication.

## Validation and publication

Construct the exact `lane-ledger-v2` object. Its source copies both
`artifact_id` and `sha256` from the input artifact. Validate the lane and the
cross-contract source binding through
`.agents/workflow-contracts/contracts.mjs`.

After validation, calculate `.omo/lanes/<lane-id>.json` beneath the primary
repository root and publish the ledger plus approval receipts exclusively.
Never overwrite a target, follow a symlinked output directory, or leave
candidate/receipt files on failure or collision.

## Result

Success returns `status: ready` and the relative ledger path. Rejection returns
`status: rejected` with a stable reason. The next workflow is
`$execute-lane .omo/lanes/<lane-id>.json`; create-lane itself performs no
execution side effect.
