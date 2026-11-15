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

`common.readable_index` is decoder-free machine metadata derived from those
authenticated receipts and raw artifacts, with exact head/tree, distinct
`contract_sha256` and `policy_sha256`, actual command outcomes/durations and
source references. Actual Node reporter summaries or a receipt's `test_results`
artifact supply test metadata; missing counts remain `null`. A receipt's
`packed_receipt` supplies the actual packed command inventory, authenticated
against each command receipt, separate raw streams, combined log and any browser
report. Retain packed artifacts beside their original producer receipt when
archiving; producer absolute paths are relocated within that artifact subtree.
An optional input `readable_index:{path,sha256,bytes}` authenticates a previously
retained index and must equal the freshly derived index. Missing, truncated,
altered or rebound index/source evidence is an input-preparation failure.
Every selected axis receives the identical returned index; no decoder, shell
execution or invented summary counts are required to inspect it.

Give each selected child the returned `reviewers[i].input` unchanged: every
axis receives the same `common` contract/policy, source footprint, authored
diff, checkout and focused evidence. Do not substitute an implementer-reported
path list, the contract digest for the policy digest, or another checkout.

## Review wave

Read only the references for selected axes:

- `references/reviewers/contract.md`
- `references/reviewers/code.md`
- `references/reviewers/verification.md`

Dispatch all selected axes in one background task batch using each returned
`reviewers[i].dispatch.subagent_type`:
`fluo-contract-reviewer`, `fluo-code-reviewer`, or
`fluo-verification-reviewer`, with `run_in_background: true`. Each registered
agent first reads its matching role reference from the supplied exact-head
checkout. Missing registration or runtime unavailability is typed
`input-preparation` with `fix_back_eligible: false`, recorded through
`execute-lane`'s dispatch admission contract; never use a category substitute
or turn this into implementation fix-back. Each child stays
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
implementation or conflict-resolution head requires fresh review of every
required axis. The only exception is Git-authenticated retention below;
raw old-head envelopes never combine with new-head results.

### Explanatory-document retention

The CLI observes previous/current merge-bases against immutable origin/base,
both authored path sets, and their actual head-to-head delta with
`--no-renames -z`. The delta intersected with the union of authored paths must
be nonempty explanatory Markdown. A closed allowlist admits root/package
README pairs, `docs/guides`, `docs/getting-started`, `docs/architecture` Markdown,
and numbered Book chapters. Instructions, governance, tests/fixtures,
generated or machine-read Markdown, MDX and unknown roles are excluded.
Every non-explanatory authored path must retain identical raw blob SHA-256
and Git mode at both heads, including paths previously authored then removed.
Unavailable or uncertain Git evidence requires full review.

Only a canonical previous PASS under the identical contract and full effective
policy permits retaining active code/verification axes. Contract is always
fresh; no inactive axis gains a PASS. Preparation independently re-observes Git
and matches the canonical fresh dispatch. Every fresh reviewer still receives
the complete diff, source footprint and new-head focused receipts. Full policy,
its digest and the approved axis floor remain unchanged.

The current-head fact's optional `retention` has exactly:
`version:1`, `previous_head_sha`, `new_head_sha`, `contract_sha256`,
`policy_sha256`, `previous_merge_base_sha`, `new_merge_base_sha`,
`previous_review`, `previous_accepted_at`, `changed_files`, `compared_files`.
`previous_review` preserves the complete canonical PASS and original identities.
`changed_files` is the sorted unique authored delta. Each sorted unique
comparison is exactly `{path, axes, previous_sha256, new_sha256,
previous_mode, new_mode}`, with sorted unique retained code/verification axes.
Git observes absence as null; absent, changed or unreadable non-prose blobs/modes
cannot retain PASS. Every nested hop and original envelope head is validated.
The CLI reauthenticates complete coverage and bytes both at admission and
observation. Changed contract/policy, missing previous PASS or tampering removes
the exception. Local-checks, omission audits, generated-integration receipts
and full current-head GitHub CI retain their independent exact-head gates.

## Machine interface

Take the current `obs.preflightPolicy` from lane `plan`. Its `sha256` binds
both the fixed contract and effective axes. Do not substitute the artifact's
own `sha256` (the implementation binding) for this policy digest.

Each new reviewer returns exactly `reviewer`, `agent`, `reviewed_head_sha`,
`preflight_sha256`, `verdict_signal`, and `blockers`; `preflight_sha256` equals
the effective policy digest.
`agent` must equal the registered target for that axis. New `record` review
successes carry this complete aggregate input with `ok:true`. Stored legacy
facts without `agent` retain full head/policy/verdict/blocker validation and
their original bytes and acceptance bindings; new inputs cannot use that path.
Assemble:

```text
{ head_sha, preflight_sha256, active_axes, reviews }
```

`aggregateReviewerGate(input, policy, retention?)` validates this payload.
`buildReviewFact(input, headSha, policy, retention?)` derives the persisted verdict; the
lead must not invent aggregate fields independently of the envelopes.
Only the CLI supplies the optional final argument from stored facts and Git.
The external four-key payload stays unchanged: `active_axes` is the full
effective policy and `reviews` contains exactly the fresh required envelopes.
Caller-supplied retention is rejected. Omitting the final argument preserves
the original exact-head behavior. `validateReviewFact(value, headSha, policy)`
accepts optional stored retention, validating fresh and retained coverage
without rewriting original reviewer heads or legacy facts.
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
