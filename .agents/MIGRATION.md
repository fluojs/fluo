# OMO+Senpi workflow migration

The native workflow is:

```text
$search-issue -> $create-lane -> $execute-lane
                                  |- $issue-to-pr
                                  `- $pr-to-merge
```

## Ownership

- Skills define inputs, procedure, outputs, authority, and stop conditions.
- The top-level lead is the only canonical ledger writer.
- Background tasks implement or review one typed assignment.
- DAG nodes schedule acyclic attempts; the persisted ledger remains resume
  truth.
- Goal and todo state are user-facing projections.
- Memory stores durable preferences and decisions, never issue/PR/retry state.

## State roots

- `.omo/search-issue/runs/<run-id>/`: discovery ledger and task evidence.
- `.omo/search-issue/artifacts/<artifact-id>.json`: v2 lane handoff.
- `.omo/lanes/<lane-id>.json`: canonical v2 lane snapshot.
- `.omo/lane-runs/<lane-id>/events.jsonl`: append-only attempt events.

The former `.opencode` assets are preserved under `.opencode-backup/` after
cutover. Native workflows must not read that archive as a runtime fallback.

## Cutover

1. Quiesce legacy mutation and finish or explicitly park active lanes.
2. Verify every native entrypoint and machine contract.
3. Import actionable legacy artifacts with SHA-256 receipts.
4. Atomically preserve `.opencode` as `.opencode-backup/`.
5. Confirm active runtime references use only `.agents/**` and `.omo/**`.

Rollback restores the control plane only. Remote GitHub issues, PRs, and merges
are reconciled into the restored ledger; they are never silently undone.
