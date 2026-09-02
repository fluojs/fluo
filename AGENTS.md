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
- **Lane-Scoped Grants**: A v2 lane ledger's `authority_scope` IS the explicit approval above, scoped to that lane's issues: `pr_merge: true` authorizes merging that lane's PRs (squash per `pr_merge_method`) and `cleanup_command_worktrees: true` authorizes removing that lane's worktrees and branches. Do not re-ask per issue.
- **Behavioral Contract Precedence**: Implementation must adhere to documented behavioral contracts in `README.md` and `docs/contracts/` before proceeding with changes.

## Subagent Dispatch Discipline
- **Background by Default**: On `main`, dispatch every subagent with `run_in_background: true`. A foreground wait detaches at the prompt-cache-safe budget anyway, so a foreground spawn only costs a blocked lead turn without changing the child's lifecycle. Let the completion notification wake the session; use `task_output` for a single midpoint peek and `task_send` to steer.
- **Parallel Waves Stay Parallel**: Independent children (for example the `$pr-to-merge` contract/code/verification triad) are dispatched in one wave of background spawns, never serialized behind one another's results.
- **Reviewers Get the Reviewed Head**: A reviewer that must read a specific commit is handed a checkout actually at that commit. `main` is usually not that commit. Create a detached review worktree (`git worktree add --detach .worktrees/review-<pr> <head-sha>`), pass that absolute path in the prompt, and state explicitly that the changed files must be read from there. A reviewer left to read `main` reviews base-state code and fails closed on tooling access rather than on the change.
- **Pass Captured Evidence Inline**: Command output the lead already captured under its own authority (head SHA re-checks, `gh pr checks` results) belongs in the child prompt. A read-only reviewer without shell access cannot re-derive it and must otherwise return `NEEDS-HUMAN-CHECK` for a gap that is not a defect.

## Project-Local OMO+Senpi Assets
- **Local Scope**: Fluo-specific native assets live under `.agents/` and runtime state lives under `.omo/`. Use them only inside this repository; do not promote them to global configuration unless explicitly requested.
- **Skills**: For Fluo workflow, governance, audit, documentation, or release work, inspect `.agents/skills/*/SKILL.md` before relying on generic guidance.
- **Role Prompts**: Specialized reviewer, guardian, auditor, and implementer prompts live under the owning skill's `references/` directory. They are project-local prompt references, not globally registered `subagent_type` values. Read the matching reference and include it in a self-contained category-routed task.
- **Workflow Entry Points**: Native entrypoints are `$search-issue`, `$create-lane`, `$execute-lane`, `$issue-to-pr`, `$pr-to-merge`, and `$docs-sync-guardian`. `$execute-lane` resolves to the v4 engine (`.agents/skills/execute-lane/`): a pure decision engine plus fresh git/GitHub observation, with no session-bound run identity. Hand it a `$create-lane` ledger with `init --from-lane-v2 .omo/lanes/<lane-id>.json`. The superseded DAG-based v1 is retained read-only at `.agents/skills/execute-lane-v1/` for reference and must not be invoked for new lanes.
- **Runtime Truth**: Canonical run artifacts, lane snapshots, and append-only event evidence live under `.omo/`. Goal, todo, task, and DAG state are projections and never replace persisted workflow evidence.
- **Legacy Archive**: Former OpenCode assets are preserved read-only under `.opencode-backup/`. Native workflows must not load that archive as an active runtime fallback.
- **Boundary Preservation**: Reviewer/auditor/guardian roles stay read-only; implementers work only inside assigned `.worktrees/<branch>` paths; release and GitHub side effects still require the explicit gates above.
