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
6. Parse `--recommend-issues` and `-ri` as equivalent opt-in flags after the
   intake value. Remove the flag before intake discrimination. Without either
   flag, skip related-issue discovery.

## Interaction and receipt sequence

The validated invocation or artifact defines the initial issues without a
confirmation question. Unless recommendation was explicitly enabled, skip
related candidate discovery and derive an empty additions decision. When
`--recommend-issues` or `-ri` enables discovery:

1. If recommendations are empty, ask nothing and derive an empty additions
   decision.
2. Otherwise ask once whether to include all, none, or an explicit subset.
3. Require included and excluded lists to be unique, disjoint,
   recommendation-order-preserving, and an exact partition.
4. Append included issues to the artifact issue order; store excluded issues in
   `suggested_but_excluded` in the approved plan.
5. Generate the final grouping, dependency graph, merge/retry policy, authority
   scope, and lane identity without another normal question.

Persist `confirmed-issues`, `suggested-additions`, and `lane-plan` as three
distinct plan/source-bound stage receipts. The confirmed and normal lane-plan
receipts are derived machine evidence. The additions receipt records the sole
normal response or the derived empty decision, including the default
recommendation-disabled path. Receipt count is not interaction count.

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

Create new plans with `preflight_overlap: 1` before computing receipt digests.
Its presence and value are copied by `readyLedger` and v4 import. Absent fields
in historical plans, ledgers and v4 files remain absent on save; only an absent
field or the exact integer 1 is supported.

New production plans include `dependency_reasons` before any receipt digest is
calculated, including `[]` for no edges. It is an optional sibling of the
unchanged `dependency_graph`: `[{ issue, depends_on, reason }]`, with exactly
those keys, positive safe integers, a nonblank reason, actual graph membership,
no duplicate edges and complete coverage of all edges. `issue` is the dependent
and `depends_on` its prerequisite. Old plans/ledgers without reasons stay valid.
`readyLedger` preserves presence and values without filling omissions.
Changing a reason changes the approval binding, not execution dependencies.
V4 import retains the source byte digest but does not copy reasons into
execution fields. External prerequisites retain the existing producer/validator
acceptance and v4 import rejection boundary.

Dependency edges express semantic requirements on another issue's outcome.
Sharing a file or package alone never creates an edge. Preserve
`predicted_conflicts` as compatibility hints; execution derives actual file
overlap ordering from valid accepted preflights' `predicted_files`, allowing
ready preflight and implementation work to proceed in parallel.

Before receipt binding, derive generated-consumer planning evidence through
`scripts/generated-conflicts.mjs` (relative to the owning skill): read the actual
consumer with `generatedConsumerGraph(root)`, then call
`withGeneratedConflicts(plan, liveIssueObservations, graph)`. This is a read-only
compiler/config and generator-source graph scan, not artifact regeneration.
The graph records current Git tracking, and new plans omit generated hints for
untracked consumers. The two ignored React example artifacts are prepared before
consumption. Existing ledgers retain their recorded hints, bindings and receipts
unchanged, including when v4 imports them.
The resulting optional `predicted_conflicts` field is part of the immutable plan,
all receipt digests and the ready ledger. Shared inputs remain hints, not edges.
`planIsCanonical`, both workflow/governance validators and v4 import validate
the same evidence and exact optional keys. Legacy plans without hints keep their
original meaning.

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

The trusted lead supplies `artifact_path`, `plan`, `approvals`,
`recommend_issues`, and `recommended_issue_numbers` to:

```text
node .agents/skills/create-lane/scripts/publish.mjs \
  --input <trusted-lead-input.json> --root <repository-root>
```

The entry reads the canonical artifact under the supplied root, validates its
identity and bytes, and consumes existing approval evidence. It rejects fixture
artifact maps and synthetic GitHub observations. Production requires the marker
and reasons to be prepared before approval; it never backfills an approved plan.
`prepareScenario(path)` remains the fixture adapter. Both paths share
preparation/validation in `scripts/contracts.mjs` and atomic publication in
`scripts/publication.mjs`. Neither performs GitHub writes, creates a branch or
worktree, dispatches execution, or synthesizes an approval.

## Planning ledger field consumers

`scripts/plan-contracts.mjs:readyLedger` is the producer.
`planIsCanonical`, `approval-contracts.mjs`, shared
`.agents/workflow-contracts/contracts.mjs`/schema and the governance
`tooling/governance/lane-ledger-*` modules are validators. Tests (`*.test.*`)
and fixtures are regression material, not live execution consumers. Markdown
is a lead/agent contract. `laneV2ToInitSpecs` in execute-lane's CLI and the v4
engine/coordinator are execution consumers only for the imported fields below.
Same-named search `run_id`, GitHub run IDs, receipt versions, and v4
branch/worktree/PR fields are separate identities, not v2 field consumers.

| V2 field | New ledger | Consumer and reason |
| --- | --- | --- |
| `version` | Keep | V4 importer discriminates v2; shared/schema/governance validate the format. |
| `run_id` | Keep | Shared and governance validate matching lane identity; it is not live execution state. |
| `lane_id` | Keep | V4 importer supplies execution identity; approval receipts bind it. |
| `status` | Keep `ready` | Governance/shared classify the planning shape; legacy status validation remains. It is not v4 execution progress. |
| `created_by` | Keep | Schema/governance validate producer provenance. |
| `base_branch` | Keep | V4 importer and engine use the base; validators check safe branch syntax. |
| `source` | Keep all fields | `assertLaneSourceBinding` and `validateSource` validate artifact provenance; `sourceLedgerRef` binds original ledger bytes, not a normalized copy. |
| `merge_policy` | Keep | `validateRetryPolicy` checks bounded/adaptive meaning; it is not an imported engine setting. |
| `pr_merge_method` | Keep | Schema/governance and `AGENTS.md` bind the lead's squash merge contract. |
| `authority_scope` | Keep complete object | Validators and the lead's Markdown authority contract enforce all boundaries. |
| `authority_scope.pr_merge` | Keep | V4 importer supplies the engine's merge grant; `AGENTS.md` also defines lead authority. |
| `authority_scope.cleanup_command_worktrees` | Keep | Schema/governance and `AGENTS.md` retain the lead's cleanup grant; not a v4 imported field. |
| `authority_scope.issue_creation` | Keep | Schema/governance and lead boundary deny issue creation. |
| `authority_scope.pr_creation` | Keep | Schema/governance and lead boundary retain PR creation authority. |
| `authority_scope.root_main_sync_ff_only` | Keep | Governance validates legacy sync evidence; the lead contract retains ff-only authority. |
| `authority_scope.publish_via_github_actions` | Keep | Schema/governance and lead boundary deny package publication by this workflow. |
| `retry_policy` | Keep | V4 import and pure engine consume the approved policy; governance validates it with merge policy. |
| `execution` | Omit | Legacy schema/governance validation only; v4 does not import this state. |
| `confirmed_issues` | Keep | Approval validators bind membership; v4 imports issues and dependencies. |
| `suggested_but_excluded` | Omit ledger copy; keep plan | `validateApprovals` uses the approved plan for recommendation partition; ledger copy only served legacy validation. |
| `backlog_candidates` | Omit ledger copy; keep plan | `planIsCanonical` validates plan nonoverlap with confirmed issues; ledger copy only served legacy validation. |
| `release_handoffs` | Keep | Preparation and approval validate attested core release tasks; governance checks membership, dedicated single-issue lanes and no completion. Not read by v4 import. |
| `lane_plan_approval_sha256` | Keep conditionally | Preparation adds the exceptional authority receipt binding for handoffs; governance requires it then. Normal lanes omit it. No new release routing is implied. |
| `completed_issues` | Omit | Legacy progress/schema/state validators only; no v4 import. |
| `issue_progress` | Omit | Legacy governance plus historical `assertSameHeadReview` consume it; no v4 import. Planning-only input without head evidence fails review closed. |
| `lanes` | Keep grouping | Plan and governance validators enforce queues and release-handoff grouping; not imported execution lanes. |
| `lanes[].name` | Keep | Approved grouping and schema/governance validation; not the engine's issue identity. |
| `lanes[].queue` | Keep | Plan/shared/governance validate exact issue partition and dedicated handoff lanes. |
| `lanes[].current_issue` | Omit | Legacy shared/governance cursor validation only. |
| `lanes[].status` | Omit | Legacy governance progress/state validation only. |
| `lanes[].branch` | Omit | Legacy shared/governance branch and ownership validation only. V4 has its own observed identity. |
| `lanes[].worktree` | Omit | Legacy shared/governance matching worktree validation only. |
| `lanes[].pr` | Omit | Legacy governance PR assignment and progress validation only. |
| `lanes[].retry_count` | Omit | Legacy governance retry/progress validation only. |
| `dependency_graph` | Keep | V4 importer/engine consume number-array prerequisites; plan/governance validate graph semantics. |
| `dependency_reasons` | Preserve when present | Plan/shared/governance validate edge evidence; new production plans include it before binding. Not imported execution state. |
| `predicted_conflicts` | Preserve when present | Producer derives hints; plan/shared/governance validate; v4 importer and coordinator consume hints without adding dependency edges. |
| `preflight_overlap` | Preserve when present | V4 import/coordinator consume opt-in; validators accept only 1 when present. Never backfill legacy plans or lanes. |
| `root_main_sync` | Omit | Legacy governance state/authority validation only; not imported by v4. |

New ready v2 values contain no legacy state fields. If any legacy state field
appears, shared and governance validation require the complete legacy shape
and its existing relationships; partial deletion is corruption, not migration.
V1 and non-ready legacy requirements remain unchanged. Schema property
definitions remain available for old ledgers. Never insert defaults, rewrite
inputs, normalize before digests, or migrate persisted ledgers/receipts.
`approvalBinding` hashes the complete original plan in canonical key order;
`planIsCanonical` keeps the old exact-key shape plus its optional hints,
marker and reasons. Historical approved plans retain their excluded/backlog
fields and original hashes.

## Result

Success returns `status: ready` and the relative ledger path. Rejection returns
`status: rejected` with a stable reason. The next workflow is
`$execute-lane .omo/lanes/<lane-id>.json`. That consumer imports the planning
ledger into v4 intent and derives next actions from live git/GitHub state,
without a DAG or session-bound supervisor. Create-lane itself performs no
execution side effect.
