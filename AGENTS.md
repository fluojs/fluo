# fluo AGENTS Shared Invariants

This file defines the always-on project rules and behavioral contracts for all OpenCode/OMO agents and workstreams within the fluo repository. These invariants take precedence over general agent defaults.

## User Communication Policy
- **Korean First**: All user-facing output, status reports, and communication must be written in Korean.
- **Maintain Context**: Keep technical identifiers (GitHub URLs, branch names, file paths, package names, labels, commands, code identifiers, repository strings) in their original English form.
- **No Translation for Logs**: Raw command output, log output, and quoted source text must not be translated.

## Agent Persona & Identity
- **Prefix**: All custom agents created for this project must use the `fluo-` prefix (e.g., `fluo-lane-supervisor`).
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

## Project-Local Codex Assets
- **Local Scope**: Fluo-specific Codex assets live under `.codex/` in this repository. Use them only for work inside this repository; do not promote them to global Codex config unless explicitly requested.
- **Skills**: For Fluo governance, audit, documentation, or release work, inspect `.codex/skills/*/SKILL.md` before relying on generic guidance.
- **Agent Roles**: Fluo role definitions live in `.codex/agents/*.toml`. These are project-local role prompts, not globally registered agent types by default. When a task mentions a `fluo-*` reviewer, guardian, auditor, or implementer, read the matching TOML and use its `developer_instructions` as the delegated role prompt.
- **Command Harnesses**: Fluo command-like workflows live in `.codex/commands/*.md`. Treat these as entrypoint harness references for requests such as `pr-to-merge`, `issue-to-pr`, `search-to-issue`, `docs-sync-guardian`, `package-publish`, and `lane-supervisor`.
- **Boundary Preservation**: OpenCode permission frontmatter was migrated as behavioral constraints, not as a Codex runtime sandbox. Preserve the same boundaries manually: reviewer/auditor/guardian roles stay read-only; implementer roles work only inside assigned `.worktrees/<branch>` paths; release and GitHub side effects still require the explicit gates above.
