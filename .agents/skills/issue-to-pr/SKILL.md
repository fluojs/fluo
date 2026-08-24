---
name: issue-to-pr
description: Native Fluo issue implementation invoked with leading $issue-to-pr. Creates or reuses one issue branch/worktree/PR identity, delegates edit-test-commit work to a scoped implementer task, and reserves push and PR mutation for the lead.
---

# Issue to PR

Use this skill only inside the Fluo repository. It converts one GitHub issue
into one verified PR head, or applies canonical fix-back blockers to that same
branch, worktree, and PR.

## Input

Accept one typed input defined by `scripts/contracts.mjs`:

- `mode: new-pr` starts from an issue with no existing PR or blockers.
- `mode: fix-back` requires the existing PR identity, one or more canonical
  unresolved blockers, and `fix_back_attempt` from 1 through 3.
- Both modes bind `lane_id`, issue identity, base branch,
  `issue-<number>-<short-title>`, `.worktrees/<branch>`, and the starting head.

Run `assertIssueToPrInput` before repository or GitHub side effects. Do not load
legacy OpenCode commands, skills, agents, permission blocks, or runtime paths.
Read `references/workflow.md`, `references/implementer.md`, and the shared
contracts under `.agents/workflow-contracts/`.

## Authority

The native lead owns orchestration and is the only actor authorized to push or
create/update a PR. The implementer task may edit only inside the assigned
worktree, run diagnostics/tests/builds, stage files, and commit on the assigned
branch. It may not push, create or mutate a PR, merge, close issues, clean up,
or publish.

These boundaries are machine-readable as `leadAuthority` and
`implementerAuthority` from `scripts/contracts.mjs`. Do not widen them in a
task prompt.

## Execution

Follow `references/workflow.md` end to end:

1. Validate the typed input and resolve issue context.
2. For `new-pr`, create the canonical branch and dedicated worktree from the
   selected base. Fail closed on collisions.
3. For `fix-back`, validate that the existing worktree checkout and PR head are
   exactly the supplied identity. Never create a replacement branch, worktree,
   issue, or PR.
4. Capture `starting_head_sha`, then dispatch one native implementer task using
   `references/implementer.md`.
5. Validate the child report and repository identity. Completion requires a
   commit that advances the assigned branch to a new head.
6. The lead runs or confirms the closest canonical verification, pushes the new
   head, then creates a PR for `new-pr` or confirms the existing PR received the
   fix-back head.
7. Validate the final typed output with `assertIssueToPrResult` before reporting
   completion.

Use one native task, not a persistent team. A missing task result may be
re-requested once from the same child session. Missing, malformed, unchanged-
head, or identity-conflicting results fail closed as
`blocked-child-contract-error`; never synthesize success from prose.

## PR contract

For `new-pr`, use `Resolve #<issue-number>: <summary>` and fill the repository
PR template, including `Closes #<issue-number>`, testing, behavioral contract,
public export documentation, platform consistency governance, and release
impact. For `fix-back`, preserve the exact existing PR number, URL, and head
branch; do not create another PR.

Do not merge or clean up. Those are separate gated workflow responsibilities.

## Output

Return the exact typed completion object accepted by
`assertIssueToPrResult`: mode and lane identity, issue, branch, worktree, PR,
previous/new/commit SHA, changed files, passed verifier receipts, fix-back
result, addressed blockers, and remaining blockers. `head_sha` must differ from
`starting_head_sha`, and `commit_sha` must equal that new head.

User-facing reports are Korean-first while paths, commands, URLs, and code
identifiers remain unchanged.
