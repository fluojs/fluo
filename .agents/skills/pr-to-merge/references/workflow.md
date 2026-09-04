# Native `$pr-to-merge` workflow

This workflow owns read-only PR context collection, reviewer dispatch, and gate
aggregation. It has no mutation or merge authority.

## Preflight

1. Resolve exactly one PR and default the base branch to `main`.
2. Read PR metadata, body, base branch, head branch, and the full 40-character
   head SHA with read-only `gh pr view`.
3. Resolve the linked issue from explicit intake first, then an unambiguous PR
   reference. Read its title and body when present.
4. Collect changed paths, relevant diff hunks, and current checks using
   read-only `gh pr diff`, `gh pr checks`, and `gh run view` commands.
5. Read `.github/PULL_REQUEST_TEMPLATE.md`, `CONTRIBUTING.md`,
   `docs/contracts/behavioral-contract-policy.md`, and contract/package docs
   relevant to the changed paths.

If intent cannot be reconstructed from a linked issue, PR body, and contracts,
record that fact for the contract reviewer. If current checks are absent or
incomplete, record that fact for the verification reviewer. Neither condition
may be silently converted to PASS.

## Same-head reviewer wave

Create exactly three native background tasks in one parallel batch. Every spawn
uses `run_in_background: true`; a foreground wait detaches at the prompt-cache
budget anyway and only blocks the lead.

- `contract`, using `reviewers/contract.md`
- `code`, using `reviewers/code.md`
- `verification`, using `reviewers/verification.md`

Before dispatch, materialize the reviewed head as a detached worktree:

```bash
git worktree add --detach .worktrees/review-<pr> <head-sha>
git -C .worktrees/review-<pr> rev-parse HEAD
```

Reviewers are read-only and may lack shell access, so they cannot fetch a head
or decode pack objects. Each prompt must give the absolute worktree path, state
that changed files are read from there and not from the `main` checkout, and
inline the evidence the lead already captured under its own authority: the head
SHA re-check and the verbatim `gh pr checks` result rows. A reviewer pointed at
`main` reviews base-state code, and a reviewer denied captured check output
fails closed on a tooling gap that is not a defect. Remove the review worktree
only after the gate reports.

Each prompt includes the PR identity, linked issue, base branch, captured head
SHA, changed paths, and the evidence relevant to that reviewer. Each task is
read-only and returns one JSON envelope:

```json
{
  "reviewer": "contract",
  "reviewed_head_sha": "0123456789012345678901234567890123456789",
  "verdict_signal": "PASS",
  "blockers": []
}
```

Allowed signals are `PASS`, `BLOCK`, and `NEEDS-HUMAN-CHECK`. A `BLOCK` envelope
contains at least one canonical blocker. Other signals contain no blockers.
Reviewers do not write shared state.

Wait for all three tasks. Missing, failed, duplicated, or malformed results
block aggregation. Do not retry one reviewer against a newer head while keeping
older results from its peers.

## Head revalidation and aggregation

Immediately before aggregation, read the PR head SHA again. If it differs from
the captured SHA, discard the entire triad and report a stale-head rejection;
a later run must review the new head with all three reviewers.

Call `aggregateReviewerGate` with exactly:

```json
{
  "head_sha": "0123456789012345678901234567890123456789",
  "reviews": []
}
```

Aggregation precedence is fail-closed:

1. Any `BLOCK` produces `block` and returns all canonical blockers.
2. Otherwise any `NEEDS-HUMAN-CHECK` produces `needs-human-check`.
3. Only three same-head `PASS` envelopes produce `merge`.

Canonical blockers use exactly `reviewer`, `signature`, `evidence`,
`fix_back_eligible`, and `status`. `status` is `unresolved` at review time.
`fix_back_eligible` is false only for maintainer decisions, scope redefinition,
or security/privacy/legal/policy judgments that cannot be fixed on the PR head.

## Report

Write the user-facing report in Korean while preserving technical identifiers.
Include:

- `result: verdict=<merge|block|needs-human-check>`
- PR and linked issue identity
- reviewed head SHA
- concise evidence summary per reviewer
- canonical blockers and non-blocking notes
- `merge only if...`

The report is the terminal product. Do not merge, approve, comment, edit, push,
publish, or clean up anything after producing it.
