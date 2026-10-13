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

After canonical `plan` selects review, and before spawning any reviewer, run:

```text
node .agents/skills/execute-lane/scripts/workflow-preparation.mjs review <review-input.json>
```

The entry is read-only: it returns a prepared dispatch payload on stdout or a
nonzero JSON `input-preparation` block on stderr. It neither dispatches children
nor writes facts. Do not turn a preparation block into an implementation
fix-back or a product defect. Complete or re-observe the input first.

Supply exactly `version:1`, `stage:"review"`, absolute `root`, `checkout`,
`artifact_root`, `issue`, fresh `issue_sha256`, accepted `contract`, canonical
plan's effective `policy`, `base_ref:"origin/<base_branch>"`, freshly observed
`base_head_sha`, `head_sha`, every `changed_paths`, `diff`, `required_checks`,
`evidence`, the prepared preflight `footprint`, absolute `accepted_contract_path`
pointing to the lead's authoritative current accepted artifact, and
`observation:{path,sha256,bytes}` containing the complete canonical
`plan` output `{issue,decision,obs}` with `decision.action:"review"`. The
preparer compares the artifact and observation to the supplied contract,
head, paths and effective policy, and re-reads acceptance before returning.
Capture the complete
`git diff --binary --full-index --no-renames <current-merge-base> <head>`
as an artifact, not a clipped tool display. `diff` is `{path,sha256,bytes}`
relative to `artifact_root`. The preparer authenticates the actual checkout,
repository, clean head/tree, pinned ancestor and current origin/base, derives
all authored paths independently with `--no-renames -z`, reconciles scope and
policy, and compares the complete diff bytes. `verification_base_sha` remains
the accepted pinned base; `authored_merge_base_sha` can differ after integration.

`required_checks` is the lead's complete accepted focused-command inventory.
Each evidence item is `{command,receipt:{path,sha256,bytes}}`. The authenticated
JSON receipt contains `version:1`, `complete:true`, exact `command`, `head_sha`,
`tree_sha`, `contract_sha256`, `status:"passed"`, `exit_code:0`, `signal:null`,
monotonic `duration_ms`, and `stdout`/`stderr` artifact references with the same
`{path,sha256,bytes}` shape (empty streams have zero bytes). Keep full raw
streams, not only summaries. Missing, truncated, altered, stale or out-of-scope
inputs fail before the review wave. The preparer rechecks observations after
reading evidence.

Give each selected child the returned `reviewers[i].input` unchanged: every
axis receives the same `common` contract/policy, source footprint, authored
diff, checkout and focused evidence. Do not substitute an implementer-reported
path list, the contract digest for the policy digest, or another checkout.

## Review wave

Read only the references for selected axes:

- `references/reviewers/contract.md`
- `references/reviewers/code.md`
- `references/reviewers/verification.md`

Dispatch all selected axes in one background task batch. Each child stays
read-only and reports against the same head and preflight contract. Missing
PR checks before a PR exists are not missing local evidence: the verification
axis judges regression coverage and the implementer's focused test results.
Full local CI runs only for explicitly requested reproduction or diagnosis,
after the selected reviews pass. All approved changes, including
CI/configuration, manifests and lockfiles, proceed directly to publication
after focused checks and reviews; full remote CI follows publication.

Use `scripts/contracts.mjs` to aggregate exactly one result per selected axis.
Before aggregation or rejecting any envelope, retain each raw reviewer response
with `lane-v4-cli.mjs retro-record --kind review` (see `../retrospective-lane/SKILL.md`).
Record lead adjudications/reproductions as separate incident observations.
This preserves false, stale, missing-input and confirmed blockers instead of
overwriting them with the final PASS; it never substitutes for this review gate.
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
review fact through `execute-lane`; it decides fix-back or publication.
An absent full local CI receipt or waiver is not a gate; applicable current-head
local failures still require fix-back, and omission is never a local CI PASS.
Do not push, create/update a PR, merge, or clean up. Review checkout cleanup
belongs to the lead's lane cleanup, not reviewer authority.
