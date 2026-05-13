# OpenCode Skill Migration Strategy

This document defines the compatibility and staging strategy for the six existing procedural skills as we transition to the new agent and command structure.

## Overview
To maintain stability and discoverability, old skill entrypoints will remain as compatibility stubs during the initial validation phase. Once the new commands and agents are fully validated, these stubs will be either converted into thin wrappers or deprecated in favor of the new structure.

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
- All existing `.opencode/skills/*/SKILL.md` files are preserved.
- New commands and agents are developed in parallel.
- Users can continue to invoke old skills.

### Phase 2: Implementation & Validation (Complete)
- Create new `.opencode/commands/*.md` and `.opencode/agents/*.md` files.
- New commands should utilize shared knowledge skills (e.g., `fluo-docs-governance`).
- Validation ensures parity between old and new workflows.

### Phase 3: Compatibility Stubs (Complete — T14)
- Old skill files have been refactored into **compatibility stubs**.
- Each stub provides a clear message to the user pointing to the new command.
- Stubs carry `migration_status: compatibility-stub` and `replaced_by` frontmatter fields.

### Phase 4: Deprecation
- Deferred. Old skill entrypoints remain as compatibility stubs until maintainers choose a removal window.
- Future documentation may exclusively reference new commands after that transition period.

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
