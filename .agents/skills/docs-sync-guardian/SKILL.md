---
name: docs-sync-guardian
description: Read-only Fluo documentation parity and evidence gate for one pull request.
---

# Docs sync guardian

Review one PR for EN/KO parity, companion documentation updates, tooling and CI
enforcement, and regression evidence.

Read `references/workflow.md` for the entrypoint contract and
`references/guardian.md` for the delegated reviewer role. Dispatch the role as
a read-only category-routed task; do not assume a custom subagent is globally
registered.

Return exactly one verdict: `pass`, `block`, or `needs-human-check`.

Stop when the reviewer returns a typed verdict for the current PR head. This
skill never edits files, pushes, merges, cleans worktrees, or publishes.
