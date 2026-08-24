# fluo AGENTS Shared Invariants

This file defines the always-on project rules and behavioral contracts for all OpenCode/OMO agents and workstreams within the fluo repository. These invariants take precedence over general agent defaults.

## User Communication Policy
- **Korean First**: All user-facing output, status reports, and communication must be written in Korean.
- **Maintain Context**: Keep technical identifiers (GitHub URLs, branch names, file paths, package names, labels, commands, code identifiers, repository strings) in their original English form.
- **No Translation for Logs**: Raw command output, log output, and quoted source text must not be translated.

## Agent Persona & Identity
- **Prefix**: All custom agents created for this project must use the `fluo-` prefix (e.g., `fluo-code-reviewer`).
- **Reviewer Default**: Unless explicitly granted execution authority, agents act as read-only reviewers for central gates.
- **No Co-Authored-By**: Do not include `Co-Authored-By` trailers in commit messages.

## Git & Worktree Convention
- **Worktree Path**: All isolated implementation work must occur in dedicated git worktrees under the `.worktrees/` directory.
- **Base Branch**: The default base branch for all work is `main`.

## Release & Publish Policy
- **Changesets ONLY**: The Changesets release workflow is the sole source of truth for versioning and changelogs.
- **No Local Publish**: Running `npm publish` locally is strictly forbidden. All publishing must occur via GitHub Actions (canonical path: `.github/workflows/release.yml`).
- **Release Readiness**: Any change affecting public `@fluojs/*` packages must include a `.changeset/*.md` file.
- **Single Main Release Lane**: Stable patch, minor, and major releases flow through `main` and the canonical Changesets GitHub Actions workflow.
- **Major Release Approval**: PRs carrying `major` changesets require explicit maintainer approval and consumer-facing migration notes before merge.

## Authority & Side-Effect Gates
- **Explicit Approval**: High-impact side effects require explicit user approval or command harness authority:
  - GitHub issue creation
  - Pull Request merging
  - Worktree/Branch cleanup
  - Package publishing
- **Behavioral Contract Precedence**: Implementation must adhere to documented behavioral contracts in `README.md` and `docs/contracts/` before proceeding with changes.

## Project-Local OMO+Senpi Assets
- **Local Scope**: Fluo-specific native assets live under `.agents/` and runtime state lives under `.omo/`. Use them only inside this repository; do not promote them to global configuration unless explicitly requested.
- **Skills**: For Fluo workflow, governance, audit, documentation, or release work, inspect `.agents/skills/*/SKILL.md` before relying on generic guidance.
- **Role Prompts**: Specialized reviewer, guardian, auditor, and implementer prompts live under the owning skill's `references/` directory. They are project-local prompt references, not globally registered `subagent_type` values. Read the matching reference and include it in a self-contained category-routed task.
- **Workflow Entry Points**: Native entrypoints are `$search-issue`, `$create-lane`, `$execute-lane`, `$issue-to-pr`, `$pr-to-merge`, and `$docs-sync-guardian`.
- **Runtime Truth**: Canonical run artifacts, lane snapshots, and append-only event evidence live under `.omo/`. Goal, todo, task, and DAG state are projections and never replace persisted workflow evidence.
- **Legacy Archive**: Former OpenCode assets are preserved read-only under `.opencode-backup/`. Native workflows must not load that archive as an active runtime fallback.
- **Boundary Preservation**: Reviewer/auditor/guardian roles stay read-only; implementers work only inside assigned `.worktrees/<branch>` paths; release and GitHub side effects still require the explicit gates above.
