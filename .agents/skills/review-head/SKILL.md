---
name: review-head
description: Review one exact local or PR head with the axes selected by preflight and reconciled against the actual diff; return pass, block, or needs-human-check without remote writes.
---

# Review head

This read-only stage belongs to `execute-lane`. A PR is optional. Review
approval is not permission to merge, and reviewers never execute local CI.

## Input and preparation

Require lane/issue identity, accepted preflight, captured base/head, actual
changed paths, implementation report with focused test evidence, and optional
PR identity. The post-review local CI receipt is not a prerequisite.
The lead checks actual diff scope and determines the effective axes using the
preflight contract helpers. An out-of-scope change returns to preflight.
Newly implicated axes are added; never trust implementer-reported scope alone.

Before dispatch, the lead materializes the reviewed commit:

```text
git worktree add --detach .worktrees/review-<issue>-<head-prefix> <head-sha>
git -C .worktrees/review-<issue>-<head-prefix> rev-parse HEAD
```

Give each reviewer the absolute checkout path, preflight contract and digest,
captured diff, exact head, and applicable evidence. Reviewers read changed
files from that checkout, never `main`. Inline head observations and captured
check results because a read-only reviewer may have no shell access.

## Review wave

Read only the references for selected axes:

- `references/reviewers/contract.md`
- `references/reviewers/code.md`
- `references/reviewers/verification.md`

Dispatch all selected axes in one background task batch. Each child stays
read-only and reports against the same head and preflight contract. Missing
PR checks before a PR exists are not missing local evidence: the verification
axis judges regression coverage and the implementer's focused test results.
Local CI runs only after the selected reviews pass; remote CI follows publication.

Use `scripts/contracts.mjs` to aggregate exactly one result per selected axis.
Reject missing, duplicate, malformed, unexpected, or stale evidence. Never
invent a skipped reviewer's PASS. Concrete remediation produces canonical
blockers; unavailable intent or authority produces `needs-human-check`.

Revalidate the head and preflight before accepting the aggregate. Any new
implementation or conflict-resolution head requires a new review of every
active axis; old-head approvals cannot be combined with new-head results.

## Machine interface

Take the current `obs.preflightPolicy` from lane `plan`. Its `sha256` binds
both the fixed contract and effective axes. Do not substitute the artifact's
own `sha256` (the implementation binding) for this policy digest.

Each reviewer returns exactly `reviewer`, `reviewed_head_sha`,
`preflight_sha256`, `verdict_signal`, and `blockers`; `preflight_sha256` equals
the effective policy digest. Assemble:

```text
{ head_sha, preflight_sha256, active_axes, reviews }
```

`aggregateReviewerGate(input, policy)` validates this payload.
`buildReviewFact(input, headSha, policy)` derives the persisted verdict; the
lead must not invent aggregate fields independently of the envelopes.
Record the input through the CLI, which re-observes the policy and head:

```text
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs set-fact --root . --lane <lane.json> --issue <n> --kind review --head <sha> --value '<input-json>'
```

## Output and stop

Return `pass | block | needs-human-check`, the head and preflight binding,
effective axes, individual envelopes, and canonical blockers. Record the
review fact through `execute-lane`; it decides fix-back or local CI.
Do not push, create/update a PR, merge, or clean up. Review checkout cleanup
belongs to the lead's lane cleanup, not reviewer authority.
