# Native workflow validation

## Static gates

- Four entrypoints, five execution stages, and four knowledge skills match
  the machine manifest in `.agents/README.md`.
- Every skill has matching name and description frontmatter.
- Knowledge skills declare `compatibility: omo`.
- Active execution uses v4 observations, not DAG/session-bound control state.
- Retired entrypoints are absent; stage imports resolve to their new owners.

## Behavioral gates

```text
node --test .agents/skills/execute-lane/scripts/*.test.mjs
pnpm exec vitest run tooling/governance/omo-native-contracts.test.ts tooling/governance/search-issue-native.test.ts tooling/governance/search-artifact-migration.test.ts tooling/governance/create-lane-invocation.test.ts tooling/governance/create-lane-multi.test.ts tooling/governance/issue-implement-native.test.ts tooling/governance/review-head-native.test.ts tooling/governance/omo-native-assets.test.ts
```

Exercise the real CLI with isolated git/GitHub fixtures. Cover mandatory
preflight, docs/test/full axis selection, actual-diff expansion, out-of-scope
re-preflight, malformed/missing/stale reviews, review-before-local-CI ordering,
fix-back, PR creation/push gating, remote CI, authority, cleanup, and resume.
No test should pin prose wording or use fixed sleeps for correctness.

## Evidence and authority

Preflight binds source/base evidence and the implementation contract. Reviewer
envelopes bind exact head and accepted contract; the aggregate includes exactly
the effective axes. Local CI runs after review and captures individual command
exit codes. A new head or changed contract cannot reuse earlier PASS evidence.

The lead validates branch/worktree/optional PR identity before mutation. Merge
requires same-head review, local CI, remote CI, mergeability, and a grant.
Publishing remains GitHub Actions-only. Test fixtures never grant authority.

Historical shared schemas and lane-ledger verifier tests remain regression
coverage for planning and old artifacts, not prerequisites for a v4 DAG run.
