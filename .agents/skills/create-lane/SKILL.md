---
name: create-lane
description: Native OMO lane planning invoked with leading $create-lane. Consumes one canonical search artifact, obtains three independent approvals, and atomically creates one source-bound v2 lane ledger.
---

# Create lane

Use this skill only inside the Fluo repository. It is the native OMO producer
for a ready lane ledger. Read `references/workflow.md` and use the shared JSON
contracts in `.agents/workflow-contracts`.

## Boundary

Accept exactly one `.omo/search-issue/artifacts/<search-run-id>.json` input.
Reject issue-number and artifact mixtures, legacy `.opencode` paths, malformed
artifacts, path/ID disagreement, and existing lane targets without writing a
candidate, lock, or ledger.

This skill performs read-only issue verification and lane planning. It does not
create issues, implement code, create branches or worktrees, open or merge PRs,
clean up worktrees, sync the root checkout, or publish packages.

## Required gates

Obtain these approvals in order from three distinct user interactions:

1. `confirmed-issues`: the exact selected issue set.
2. `suggested-additions`: additions are separately accepted or excluded.
3. `lane-plan`: the final issue, lane ID, branch, worktree, and current head.

An approval response cannot satisfy more than one gate. If structured questions
are unavailable, present the gate and wait for a separate plain-text response.
Never infer a later approval from an earlier response.

## Production

Build a v2 lane value, bind `source.artifact_id` and `source.sha256` exactly to
the accepted artifact, and validate both values with
`.agents/workflow-contracts/contracts.mjs`. Only after all gates and validation
succeed, exclusively create `.omo/lanes/<lane-id>.json`. A collision is terminal
and preserves the existing file.

For deterministic contract exercises, run:

```text
node .agents/skills/create-lane/scripts/run-scenario.mjs --scenario <fixture.json> --out <repository-root>
```

On success, emit the ledger path and `$execute-lane <lane-id>` handoff. On any
rejection, report the named reason and emit no handoff.
