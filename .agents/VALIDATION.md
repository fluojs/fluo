# Native workflow validation

## Static gates

- Six entrypoint skills and four knowledge skills match the manifest in
  `.agents/README.md`.
- Every skill has `name` and `description` frontmatter.
- Knowledge skills declare `compatibility: omo`.
- Native runtime paths do not depend on `.opencode` or
  `.opencode-backup/`.
- Shared JSON schemas reject unknown keys.
- `.agents/THREAT_MODEL.md` separates trusted lead authority from synthetic
  fixture evidence.

## Behavioral gates

Run the dedicated tests:

```text
tooling/governance/omo-native-contracts.test.ts
tooling/governance/omo-native-events.test.ts
tooling/governance/search-issue-native.test.ts
tooling/governance/search-artifact-migration.test.ts
tooling/governance/create-lane-native.test.ts
tooling/governance/create-lane-multi.test.ts
tooling/governance/issue-to-pr-native.test.ts
tooling/governance/pr-to-merge-native.test.ts
tooling/governance/omo-native-assets.test.ts
```

Then run the canonical lane-ledger tests and `pnpm verify`.

## Authority gates

Issue creation, lane acceptance, worktree/branch creation, commit, push, PR creation, merge, cleanup, root sync,
cutover, and rollback require a target-bound receipt. Publishing remains GitHub Actions-only.

## Resume gates

Validate the lane snapshot, event hash chain, lease, live branch/worktree/PR identity, current head, checks, and
approval freshness before resuming. Never fill missing persisted fields with compatibility defaults.

Before the single lane DAG dispatch, compile every confirmed issue supervisor and all `dependsOn` ordering into one immutable definition, reconcile one lane intent/binding, and start once. Each dependent node still requires canonical predecessor `done` before mutation. Task completion, merge without cleanup, `CLOSED` observations, and terminal blockers must never create downstream issue artifacts; terminalizing blocked dependents requires fresh absence observations for all seven artifact classes.

For new adaptive lanes, require null count and wall-clock limits, preserve attempt/time telemetry, and keep every
fixable blocker active beyond legacy numeric budgets. Non-fixable blockers must park for human resolution. Existing
bounded ledgers must continue to validate and retain their approved behavior.

All issue stores require `review_policy: "preflight-v1"` and version 2; version 1 stores are rejected. Revalidate
persisted preflight, reviewer task, coverage, blocker-source, cumulative-ledger, fresh-implementer, and conflict
resolution evidence. Revalidate each canonical reviewer JSONL digest and actual tool events. Reviewers permit only
`read` and task-local `todo`; verification reads exactly one parent-owned immutable canonical verification receipt.
Require its command/result/head/preflight binding and owner-PID stale-lock recovery; reject reviewer shell execution,
direct CI shells, unknown tools, mutation tools, and completed-node revival.

For non-empty `release_handoffs`, derive the consumed lane-plan receipt from the canonical repository approval
directory. Recompute its approval binding from the retained plan and source artifact, then compare every immutable
plan field with the execution snapshot before parking an issue. Require the recomputed binding to equal
`lane_plan_approval_sha256` in the ledger. When that field is present, always reconcile it even if a resumed snapshot
has an empty handoff array. Anchor this decision to the canonical published ledger so a persisted snapshot cannot
remove both fields and downgrade itself to legacy compatibility.
