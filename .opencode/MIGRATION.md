# OpenCode Skill Migration Strategy

This document records the migration of the six former procedural skills to command-first OpenCode entrypoints.

## Overview
The old procedural skill entrypoints were removed after validation because their names shadowed slash commands in the current OpenCode resolver. The remaining `.opencode/skills/fluo-*` directories are knowledge-only skills used by commands and agents.

## Migration Map

| Old Skill | Type | New Destination | Completed In |
| :--- | :--- | :--- | :--- |
| `lane-supervisor` | Orchestration | `.opencode/commands/lane-supervisor.md` (orchestrator) | Wave 3 / T13 |
| `pr-to-merge` | Execution (Review) | `.opencode/commands/pr-to-merge.md` + 3 reviewer agents | Wave 2 agents + Wave 3 command |
| `search-to-issue` | Execution (Audit) | `.opencode/commands/search-to-issue.md` + 3 auditor agents + `fluo-package-audit` skill | Wave 2 agents + Wave 3 command |
| `issue-to-pr` | Execution (Implement) | `.opencode/commands/issue-to-pr.md` + scoped `fluo-issue-implementer` agent | Wave 2 agent + Wave 3 command |
| `docs-sync-guardian` | Review (Docs) | `.opencode/commands/docs-sync-guardian.md` + `.opencode/agents/fluo-docs-sync-guardian.md` + `fluo-docs-governance` skill | Wave 2 |
| `package-publish` | Release Operations | `.opencode/commands/package-publish.md` + `fluo-release-operations` skill | Wave 3 / T12 |

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
- Same-name legacy skill entrypoints were removed so `/lane-supervisor`, `/issue-to-pr`, `/pr-to-merge`, `/search-to-issue`, `/docs-sync-guardian`, and `/package-publish` resolve as commands.
- Keep only knowledge skills whose names start with `fluo-`.

## Removed Legacy Skill Entrypoints

The following directories no longer contain `SKILL.md` entrypoints and should not be recreated with the same names, because they shadow commands:

- `.opencode/skills/lane-supervisor/`
- `.opencode/skills/issue-to-pr/`
- `.opencode/skills/pr-to-merge/`
- `.opencode/skills/search-to-issue/`
- `.opencode/skills/docs-sync-guardian/`
- `.opencode/skills/package-publish/`

Use the matching slash command instead.

## Key Changes by Skill

### lane-supervisor
- **From**: Monolithic procedural skill.
- **To**: A high-level orchestrator command that manages the lifecycle across other commands.

### pr-to-merge
- **From**: Procedural gate with hardcoded roles.
- **To**: A command that fans out to three specialized reviewer agents: `@fluo-contract-reviewer`, `@fluo-code-reviewer`, and `@fluo-verification-reviewer`.

### search-to-issue
- **From**: Batch auditor.
- **To**: A command managing `@fluo-package-contract-api-reviewer`, `@fluo-package-architecture-reviewer`, and `@fluo-package-tests-edge-reviewer`, supported by a `fluo-package-audit` knowledge skill.

### issue-to-pr
- **From**: Single-issue worker.
- **To**: A command managing the branch/worktree lifecycle, delegating core implementation to the scoped optional `@fluo-issue-implementer` agent or same-contract fallback executor.

### docs-sync-guardian
- **From**: Docs review gate.
- **To**: A command using a specialized `@fluo-docs-sync-guardian` agent and a `fluo-docs-governance` knowledge skill.

### package-publish
- **From**: Release protocol.
- **To**: A command focused on release lifecycle management, backed by a `fluo-release-operations` knowledge skill.
