# OpenCode Skill Migration Strategy

This document records the migration of former procedural skills to command-first OpenCode entrypoints and the later split from a single lane supervisor into human-driven lane commands.

## Overview
The old procedural skill entrypoints were removed after validation because their names shadowed slash commands in the current OpenCode resolver. The remaining `.opencode/skills/fluo-*` directories are knowledge-only skills used by commands and agents.

## Migration Map

| Old Skill | Type | New Destination | Completed In |
| :--- | :--- | :--- | :--- |
| `lane-supervisor` | Orchestration | Removed. Use `.opencode/commands/create-lane.md` followed by `.opencode/commands/execute-lane.md` | Wave 4 / lane split |
| `pr-to-merge` | Execution (Review) | `.opencode/commands/pr-to-merge.md` + 3 reviewer agents | Wave 2 agents + Wave 3 command |
| `search-to-issue` | Execution (Audit) | Renamed to `.opencode/commands/search-issue.md` + purpose-based reviewer/R&D agents + `fluo-package-audit` skill | Wave 4 / command rename + purpose routing |
| `issue-to-pr` | Execution (Implement) | `.opencode/commands/issue-to-pr.md` + scoped `fluo-issue-implementer` agent | Wave 2 agent + Wave 3 command |
| `docs-sync-guardian` | Review (Docs) | `.opencode/commands/docs-sync-guardian.md` + `.opencode/agents/fluo-docs-sync-guardian.md` + `fluo-docs-governance` skill | Wave 2 |
| `package-publish` | Release Operations | Removed. Release/publish execution is handled by GitHub Actions Changesets workflow; OpenCode commands only record release handoff state. | Wave 4 / release simplification |

## Lane Command Split

The former `lane-supervisor` command was removed because it combined discovery, lane planning, execution, review, merge, cleanup, and resume behavior in one entrypoint. The current human-driven flow is:

1. `/search-issue` — package issue discovery, purpose-based reviewer/R&D routing, issue drafts, registration triage, harness-authorized issue creation.
2. `/create-lane <issue...|search-run-id|search-ledger-path> [base-branch]` — confirmed issue set, suggested additions gate, semantic lane planning, `.omo/lanes/<lane-id>.json` creation.
3. `/execute-lane <lane-id|lane-ledger-path> [resume|--full-auto] [base-branch]` — ledger-based implementation dispatch, PR review gate, bounded fix-back, gated merge/cleanup/root sync.

`/search-issue` must not create lane ledgers. `/create-lane` must not implement or review PRs. `/execute-lane` must not discover/register new issues or rewrite lane scope.

## Canonical v1 completion evidence

The strict v1 root has exactly 21 required keys: `version`, `run_id`, `lane_id`, `status`, `created_by`, `base_branch`, `source`, `merge_policy`, `pr_merge_method`, `authority_scope`, `retry_policy`, `execution`, `confirmed_issues`, `suggested_but_excluded`, `backlog_candidates`, `release_handoffs`, `completed_issues`, `issue_progress`, `lanes`, `dependency_graph`, and `root_main_sync`. Only `created_at` is optional. `run_id === lane_id`, both identities are path-safe basenames without `+`, lanes and queues are non-empty, and optional `created_at` is strict UTC. A `search-issue` source uses the source-only basename grammar `[A-Za-z0-9][A-Za-z0-9+._-]*`, preserving internal `+` characters from timezone-bearing producer IDs, and requires the exact `.sisyphus/search-issue/<search_run_id>.json` path.

The lane ledger contract is now strict canonical v1. There is no version bump and no compatibility shim for incomplete v1 data. A legacy ledger that reaches completion without canonical evidence is rejected with `migrate legacy completion evidence to canonical issue_progress` and must be migrated before execution can continue.

Migration is an explicit, read-only review of the existing evidence followed by a complete rewrite of the completion record. It must produce a flat `issue_progress` entry for every completed issue with:

- `review_verdict: merge`, `checks: PASS`, and exact `reviewers` values of `contract: PASS`, `code: PASS`, and `verification: PASS`.
- `merge_commit` set to the verified 40-character lowercase SHA.
- `issue_state: CLOSED`.
- `cleanup` set to exactly `{status: done, worktree_removed: true, local_branch_deleted: true, remote_branch_deleted: true}` when cleanup authority is granted, or exactly `{status: skipped-authority}` without that authority.

Progress evidence is status-specific. Non-completion statuses allow only `status`, `branch`, `worktree`, `pr`, `verification`, `retry_count`, and `blockers`. `merged` adds review, check, reviewer, provenance, merge SHA, and CLOSED issue evidence but never cleanup. `done` adds cleanup. Migration must not move completion fields into queued, running, in-review, or terminal-blocker entries to make incomplete evidence appear valid.

`dependency_graph` is sparse: keys are confirmed positive-safe-integer issues and values are unique positive-safe-integer prerequisite arrays. External prerequisite issue numbers may appear in values, but duplicate, self, and cyclic dependencies are invalid. Migration preserves the graph and never infers or removes prerequisites from execution history.

There are no nested merge or issue records in canonical v1 `issue_progress`. Live execution gates verify realpath, repository/worktree membership, and dirty state; those checks are not cleanup object fields.

The migration must preserve the original issue, PR, branch, worktree, retry, authority, execution, and release handoff facts. Do not infer PASS, MERGED, CLOSED, or cleanup success from a missing field. Do not weaken the exact status values or replace a missing decision with a default.

The real persistence ledger is intentionally failing migration evidence. It is never modified automatically. Use a read-only copy or an explicitly supplied candidate path for migration work, then validate the candidate independently. The committed lane-ledger fixtures remain the passing source of truth for the v1 shape. A standalone verifier may receive any arbitrary read-only ledger path, not only a repository fixture or a canonical repository location.

## Staging & Compatibility Strategy

### Phase 1: Coexistence (Complete)
- New commands and agents were developed while old procedural skills still existed.
- This phase ended after command/agent validation confirmed the replacements.

### Phase 2: Implementation & Validation (Complete)
- Create new `.opencode/commands/*.md` and `.opencode/agents/*.md` files.
- New commands should utilize shared knowledge skills (e.g., `fluo-docs-governance`).
- Validation ensures parity between old and new workflows.

### Phase 3: Compatibility Stub Trial (Complete — T14)
- Old skill files were briefly refactored into **compatibility stubs**.
- This preserved discoverability during validation but exposed a resolver issue: same-name skills shadowed slash commands.

### Phase 4: Command-First Cutover (Complete)
- Same-name legacy skill entrypoints were removed so `/issue-to-pr`, `/pr-to-merge`, `/search-issue`, `/docs-sync-guardian`, `/create-lane`, and `/execute-lane` resolve as commands.
- Keep only knowledge skills whose names start with `fluo-`.

## Removed Legacy Skill Entrypoints

The following directories no longer contain `SKILL.md` entrypoints and should not be recreated with the same names, because they shadow commands:

- `.opencode/skills/lane-supervisor/`
- `.opencode/skills/issue-to-pr/`
- `.opencode/skills/pr-to-merge/`
- `.opencode/skills/search-to-issue/`
- `.opencode/skills/search-issue/`
- `.opencode/skills/docs-sync-guardian/`
- `.opencode/skills/package-publish/`
- `.opencode/skills/create-lane/`
- `.opencode/skills/execute-lane/`

Use the matching slash command instead.

## Key Changes by Skill

### Strict v1 migration rejection list

Fail closed for missing `run_id`, `lane_id`, or `source`; unknown root, source, lane, progress, root-sync, reviewer, blocker, or cleanup keys; nested legacy evidence; non-prefix queues; one-sided branch/worktree/PR identity; non-normalized PR values; unequal retry counts; status-incompatible completion evidence; invalid dependency keys/edges; cleanup on non-done progress; and completed or merged release handoffs. `existing-issues` requires null search fields, while `search-issue` preserves source IDs with internal `+` and requires the exact `.sisyphus/search-issue/<search_run_id>.json` path. Queued without progress requires null branch, worktree, and PR and retry count 0. Release handoffs use a dedicated single-issue lane, queued without progress when ready, then `blocked-maintainer-decision` in both lane and progress without branch/worktree/PR dispatch identity, never completed, merged, or done.

The focused suite has exactly five TEST files and 346 tests, including `verify-lane-ledger-schema.test.ts`. `lane-ledger-schema.mjs` owns root/source/lane shape validation, `lane-ledger-progress-schema.mjs` owns status-specific progress key validation, and `lane-ledger-dependency.mjs` owns dependency graph validation. These implementation modules are not counted as test files. Producer provenance is inside exact-key validation, not outside it.

### lane-supervisor
- **From**: Monolithic procedural skill and later high-level command.
- **To**: Removed. The workflow is now explicitly split across `/search-issue`, `/create-lane`, and `/execute-lane`.

### create-lane
- **From**: Lane planning section inside `lane-supervisor`.
- **To**: A planning-only command that writes `.omo/lanes/<lane-id>.json` and hands off to `/execute-lane`.

### execute-lane
- **From**: Worker dispatch, PR review, fix-back, merge, cleanup, and resume loop inside `lane-supervisor`.
- **To**: A ledger-based execution command that consumes `/create-lane` output and preserves child command boundaries.

### pr-to-merge
- **From**: Procedural gate with hardcoded roles.
- **To**: A command that fans out to three specialized reviewer agents: `@fluo-contract-reviewer`, `@fluo-code-reviewer`, and `@fluo-verification-reviewer`.

### search-issue
- **From**: Batch auditor.
- **To**: A command that creates a package-level `route_plan` from the selected purpose, dispatches the relevant package reviewer/R&D agents, and triages `audit_finding` or `rd_brief` results into issue drafts. A read-only registration reviewer marks each draft `register`, `defer`, or `reject`, and the command harness creates only `register` issues. The original triad (`@fluo-package-contract-api-reviewer`, `@fluo-package-architecture-reviewer`, `@fluo-package-tests-edge-reviewer`) remains the `comprehensive` route, while feature, docs/book, release, and NestJS migration purposes use dedicated specialist routes. This command was renamed from `search-to-issue` to match the human-driven `/search-issue` → `/create-lane` → `/execute-lane` flow.

### issue-to-pr
- **From**: Single-issue worker.
- **To**: A command managing the branch/worktree lifecycle, delegating core implementation to the scoped optional `@fluo-issue-implementer` agent or same-contract fallback executor.

### docs-sync-guardian
- **From**: Docs review gate.
- **To**: A command using a specialized `@fluo-docs-sync-guardian` agent and a `fluo-docs-governance` knowledge skill.

### package-publish
- **From**: Release protocol.
- **To**: Removed. Release/publish is not an OpenCode command responsibility; lane execution records a release handoff and defers to the canonical GitHub Actions Changesets workflow.
