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
2. `/create-lane <issue...|search-run-id|search-ledger-path> [base-branch]` — confirmed issue set, suggested additions gate, semantic lane planning, `.sisyphus/lanes/<lane-id>.json` creation.
3. `/execute-lane <lane-id|lane-ledger-path> [resume|--full-auto] [base-branch]` — ledger-based implementation dispatch, PR review gate, bounded fix-back, gated merge/cleanup/root sync.

`/search-issue` must not create lane ledgers. `/create-lane` must not implement or review PRs. `/execute-lane` must not discover/register new issues or rewrite lane scope.

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

### lane-supervisor
- **From**: Monolithic procedural skill and later high-level command.
- **To**: Removed. The workflow is now explicitly split across `/search-issue`, `/create-lane`, and `/execute-lane`.

### create-lane
- **From**: Lane planning section inside `lane-supervisor`.
- **To**: A planning-only command that writes `.sisyphus/lanes/<lane-id>.json` and hands off to `/execute-lane`.

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
