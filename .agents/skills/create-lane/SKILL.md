---
name: create-lane
description: Native OMO lane planning invoked with leading $create-lane. Consumes one canonical search artifact, obtains three independent approvals, and atomically creates one source-bound v2 lane ledger.
---

# Create lane

Use this skill only inside the Fluo repository. It is the native OMO producer
for a ready lane ledger. Read `references/workflow.md` and use the shared JSON
contracts in `.agents/workflow-contracts`.

## Boundary

Accept exactly one canonical v2 artifact from either
`.omo/search-issue/artifacts/<search-run-id>.json` or the importer-owned
`.omo/search-issue/artifacts/legacy/<search-run-id>.json` path. Reject
issue-number and artifact mixtures, archived `.opencode` paths, deeper or
noncanonical artifact paths, malformed artifacts, path/ID disagreement, and
existing lane targets without writing a candidate, lock, or ledger.

Direct issue-number input is intentionally retired by the v2 provenance
contract. Preserve that use case by first publishing a bound artifact:

```bash
node .agents/skills/search-issue/scripts/publish-search-artifact.mjs \
  --run-id manual-<id> --issues <n1,n2> --root .
```

This skill performs read-only issue verification and lane planning. It does not
create issues, implement code, create branches or worktrees, open or merge PRs,
clean up worktrees, sync the root checkout, or publish packages.

## Required gates

Obtain these approvals in order from three distinct user interactions:

1. `confirmed-issues`: the exact selected issue set.
2. `suggested-additions`: additions are separately accepted or excluded.
3. `lane-plan`: the final multi-issue grouping, dependencies, lane ID, merge
   policy, retry policy, release handoffs, and authority scope.

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
fixable work. The policy is part of the approved immutable plan. Never rewrite
an existing lane ledger to adopt a newer default; previously approved bounded
policies retain their original limits.

`release_handoffs` is reserved for issues whose core task is a release or
publish decision that must stop at `blocked-maintainer-decision`. A public
package change that merely requires a Changeset is normal implementation work
and must not enter `release_handoffs`. Every planned handoff must occupy a
dedicated single-issue lane and bind `release-or-publish-is-core` to a SHA-256
digest of the lead's live issue observation. The `lane-plan` response must
separately attest to the same issue/digest with `changeset_only: false`;
planner-controlled text alone never authorizes a handoff.

Each persisted approval binds the complete plan plus artifact ID/SHA and is
consumed exactly once. An approval response cannot satisfy more than one gate.
If structured questions are unavailable, present the gate and wait for a
separate plain-text response. Never infer a later approval from an earlier
response.

Approval IDs and binding hashes are replay/corruption controls, not identity
signatures. Production approval exists only when the trusted lead observes
three separate native user responses. `scripts/fixtures/run-scenario.mjs`
accepts synthetic approvals for tests and is forbidden in production.

## Production

Build a v2 lane value, bind `source.artifact_id` and `source.sha256` exactly to
the accepted artifact, and validate both values with
`.agents/workflow-contracts/contracts.mjs`. Only after all gates and validation
succeed, exclusively create `.omo/lanes/<lane-id>.json` and the three consumed
approval receipts. Lane queues must partition every approved issue exactly
once. A target/approval collision is terminal, preserves existing files, and
rolls back newly linked receipts. Refuse symlinked output directories.

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
