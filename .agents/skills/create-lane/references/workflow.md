# Native `$create-lane` workflow

The native producer turns one canonical search artifact into one ready v2 lane
ledger. The artifact and shared workflow contracts are authoritative.

## Intake

1. Accept exactly one path under `.omo/search-issue/artifacts/`.
2. Require the filename stem to equal `search_run_id`.
3. Validate `search-artifact-v2`, including canonical `artifact_id` and
   `sha256` shape, before asking for or recording a plan.
4. Reject mixed forms, legacy paths, malformed JSON, unknown keys, duplicate or
   empty issue sets, and path/ID mismatches without filesystem writes.

## Approval sequence

Show the artifact candidates and obtain three separate approvals:

1. Confirmed issues approval chooses the exact artifact issue set.
2. Suggested additions approval independently accepts additions; unapproved
   suggestions do not enter the lane.
3. Lane plan approval accepts the final identity, branch, worktree, and head.

Each gate has a distinct approval identity and interaction. Missing, denied,
out-of-order, or reused approvals stop before publication.

## Validation and publication

Construct the exact `lane-ledger-v2` object. Its source copies both
`artifact_id` and `sha256` from the input artifact. Validate the lane and the
cross-contract source binding through
`.agents/workflow-contracts/contracts.mjs`.

After validation, calculate `.omo/lanes/<lane-id>.json` beneath the primary
repository root and create it exclusively. Never overwrite an existing target.
Do not leave candidate or lock files on validation failure or collision.

## Result

Success returns `status: ready` and the relative ledger path. Rejection returns
`status: rejected` with a stable reason. The next workflow is
`$execute-lane <lane-id>`; create-lane itself performs no execution side effect.
