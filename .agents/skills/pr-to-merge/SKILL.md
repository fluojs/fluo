---
name: pr-to-merge
description: Read-only Fluo PR gate invoked with leading $pr-to-merge. Collects one PR at one head, dispatches the contract, code, and verification reviewer triad, and returns exactly merge, block, or needs-human-check without merging or changing repository state.
---

# PR to merge

Use this skill only inside the Fluo repository and only for one PR per run.
This skill is a read-only decision gate, not a merge command.

## Authority

The lead and all three reviewers have read-only authority. They may inspect
repository files and use read-only `gh` and `git` commands. They must not edit
files, push, merge, approve, comment, change labels or PR state, clean a branch
or worktree, publish a package, or invoke another mutating workflow. A
`verdict: merge` is evidence for a separately authorized caller; it never
executes or authorizes `gh pr merge`.

## Intake

Require one PR URL or positive PR number. Accept an optional linked issue and
base branch; the base branch defaults to `main`. Reject multiple PRs. Resolve
provided values before inference from the PR body.

## Native assets

After intake, read:

- `references/workflow.md`
- `references/reviewers/contract.md`
- `references/reviewers/code.md`
- `references/reviewers/verification.md`
- `scripts/contracts.mjs`

Do not load or delegate to legacy `.opencode` commands, agents, prompts,
permission blocks, or runtime paths. The references above fully define the
native reviewer roles.

## Gate

Follow `references/workflow.md` end to end. Capture the PR head SHA before
review dispatch, run all three reviewers in one parallel native task wave, and
require every envelope to bind that exact head. Pass the three envelopes and
the current head to `aggregateReviewerGate` in `scripts/contracts.mjs`.

Return exactly one parsed verdict from this set:

```text
merge | block | needs-human-check
```

Never synthesize, skip, or duplicate a reviewer result. Missing, malformed,
stale-head, or unavailable reviewer evidence fails closed and cannot produce
`merge`.

## Stop

Stop after reporting the PR, linked issue, reviewed head SHA, triad evidence,
canonical blockers, non-blocking notes, and the parsed verdict. Do not perform
the merge or any other side effect.
