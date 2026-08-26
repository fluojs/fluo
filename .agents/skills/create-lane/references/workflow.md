# Native `$create-lane` workflow

The native producer normalizes one artifact path, bulk issue list, or verbal
collection request into one canonical search artifact and one ready v2 lane
ledger. The artifact and shared workflow contracts are authoritative.

## Intake

1. Accept exactly one discriminated mode:
   - `artifact`: canonical native or importer-owned legacy artifact path;
   - `issue-numbers`: an ordered nonempty unique positive integer list;
   - `verbal`: a nonempty query plus the ordered issue set resolved from fresh
     read-only GitHub observations.
2. Artifact mode requires the filename stem to equal `search_run_id`.
3. Number and verbal modes generate a safe run ID and exclusively publish their
   exact issue order through the search-issue artifact publisher.
4. Re-read and validate `search-artifact-v2`, including recomputed canonical
   `artifact_id` and `sha256`, before recommendation or planning.
5. Reject mixed forms, archived `.opencode` paths, deeper or noncanonical
   artifact paths, malformed JSON, unknown keys, duplicate or empty issue sets,
   unresolved verbal requests, and path/ID mismatches before lane publication.

## Interaction and receipt sequence

The validated invocation or artifact defines the initial issues without a
confirmation question. Search for related candidates and:

1. If recommendations are empty, ask nothing and derive an empty additions
   decision.
2. Otherwise ask once whether to include all, none, or an explicit subset.
3. Require included and excluded lists to be unique, disjoint,
   recommendation-order-preserving, and an exact partition.
4. Append included issues to the artifact issue order; store excluded issues in
   `suggested_but_excluded`.
5. Generate the final grouping, dependency graph, merge/retry policy, authority
   scope, and lane identity without another normal question.

Persist `confirmed-issues`, `suggested-additions`, and `lane-plan` as three
distinct plan/source-bound stage receipts. The confirmed and normal lane-plan
receipts are derived machine evidence. The additions receipt records the sole
normal response or the derived empty decision. Receipt count is not interaction
count.

Present `retry_count_is_terminal: false` with null count and wall-clock limits
as the default adaptive retry policy. Count attempts and elapsed time as
telemetry while the orchestrator keeps fixable work active until success.
Persist the complete retry policy in the new ledger. Existing ledgers
remain immutable and continue with their originally approved bounded or
adaptive policy.

Distinguish release metadata from execution handoffs:

- Changeset requirements stay implementation and verification obligations.
- `release_handoffs` contains only issues whose core task is release or
  publishing and therefore terminally parks for a maintainer decision.
- Each handoff is represented in the immutable plan as
  `{ "issue_number": <n>, "reason": "release-or-publish-is-core",
  "issue_evidence_sha256": "<sha256>" }` and must occupy a dedicated
  single-issue lane.
- Calculate `issue_evidence_sha256` from the canonical live GitHub observation
  `{ issue_number, issue_url, title, body, labels, updated_at }`.
- A separate exceptional trusted-lead authority response must repeat each issue
  number and evidence digest with `decision: "release-or-publish-is-core"` and
  `changeset_only: false`.

Each stage has a distinct receipt identity whose digest binds the complete plan
and source artifact. Persist consumed IDs so missing, denied, out-of-order,
substituted, or replayed evidence stops before publication. Normal ledgers omit
`lane_plan_approval_sha256`. Release-handoff ledgers store the exceptional
authority receipt binding independently so execute-lane can reject a
self-consistent forged receipt.

## Validation and publication

For generated intake, publish the immutable artifact first. An artifact
collision preserves the existing file and returns `artifact_collision`. A
later cancellation or lane collision retains the artifact as the recovery
input for artifact mode.

Construct the exact `lane-ledger-v2` object. Its source copies both
`artifact_id` and `sha256` from the normalized artifact. Validate the lane and
the cross-contract source binding through
`.agents/workflow-contracts/contracts.mjs`.

After validation, calculate `.omo/lanes/<lane-id>.json` beneath the primary
repository root and publish the ledger plus three stage receipts exclusively
as one atomic unit. Never overwrite a target, follow a symlinked output
directory, or leave candidate/receipt files on failure or collision. Never
delete generated provenance while rolling back lane publication.

## Result

Success returns `status: ready` and the relative ledger path. Rejection returns
`status: rejected` with a stable reason. The next workflow is
`$execute-lane .omo/lanes/<lane-id>.json`. That consumer compiles one immutable
ledger into one resumable native DAG with one supervisor node per approved
issue; create-lane itself performs no execution side effect.
