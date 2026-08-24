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
tooling/governance/execute-lane-native.test.ts
tooling/governance/execute-lane-persistence.test.ts
tooling/governance/execute-lane-resilience.test.ts
tooling/governance/omo-native-assets.test.ts
```

Then run the canonical lane-ledger tests and `pnpm verify`.

## Authority gates

Issue creation, lane acceptance, worktree/branch creation, commit, push, PR
creation, merge, cleanup, root sync, cutover, and rollback require a
target-bound receipt. Publishing remains GitHub Actions-only.

## Resume gates

Validate the lane snapshot, event hash chain, lease, live branch/worktree/PR
identity, current head, checks, and approval freshness before resuming. Never
fill missing persisted fields with compatibility defaults.
