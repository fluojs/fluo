---
name: sync-pr
description: Perform one execute-lane-authorized PR creation or head push after current-head verification and selected reviews pass; preserve one issue branch and PR.
---

# Sync PR

This is the remote publication stage of `execute-lane`, not an independent
issue workflow. Only the lead performs its Git/GitHub writes. It neither
implements nor reviews, waits for CI, merges, or cleans up.

## Input and gate

Require the lane path, issue identity, existing implementation branch/worktree,
current head, and optional existing PR identity. Run the canonical lane `plan`
immediately before mutation. Continue only for `create-pr` or `push`, with the
decision bound to the same current head. Other actions return to the lane.

The gate requires accepted preflight, focused local evidence, actual-diff
review scope reconciliation, and every selected axis passing at that exact
head and preflight contract. A review `pass` is not merge permission.
Full canonical local verification is not automatically required for any approved
change, including CI/configuration, manifests and lockfiles; no receipt or
waiver is needed for publication. It remains available for explicitly requested
reproduction or diagnosis after review. Applicable current-head local failures,
including receipt revalidation failures, still require fix-back. Report omission
as not run, never PASS; never invent a local CI receipt to obtain publication.
Full exact-head GitHub CI remains required before merge.
Confirm the worktree is clean, branch/head match, and no writer remains active.
The fresh plan also authenticates lead-admitted common baseline evidence for
explicitly related issues. `still-failing` returns canonical fix-back;
`different-source-or-conditions` and `insufficient-evidence` block preparation,
including missing or altered admitted artifacts. Only verified `fixed` bytes
retain the normal publication decision; source comparison is not a test PASS.
No known record or unrelated main advance requires integrating main.
Apply a verified companion only inside accepted preflight and ownership scope;
expansion returns to preflight. Retain the pinned base and existing identity.
A companion changes the head, so affected focused checks and new selected
exact-head reviews are required before publication to the same PR, followed
by full new-head canonical GitHub CI and the existing merge gates.

## Action

For `create-pr`:

1. Confirm no PR already exists for this issue branch. Reuse observed identity
   on resume rather than creating a replacement.
2. Push the assigned branch without force.
3. Create one PR titled `Resolve #<issue-number>: <summary>`.
4. Fill `.github/PULL_REQUEST_TEMPLATE.md`: `Closes #<issue-number>`,
   testing, behavioral contract, public exports, platform governance, and
   release impact. Report selected review axes and omitted-axis reasons.
5. Observe and return the created PR number, URL, head branch, and head SHA.

For `push`:

1. Verify the existing PR number, URL, and head branch match the lane issue.
2. Push the reviewed new head to that same branch without force.
3. Observe the existing PR's new head. Never create another PR.

If identity changed, return evidence to the lane rather than repairing it by
creating a new branch/worktree/PR. A partial remote success is reconciled from
fresh GitHub state before retry; never infer failure means nothing happened.

## Output and stop

Return the operation, lane/issue/branch identity, PR identity, observed remote
head, and command results. Record the action outcome through `execute-lane`.
Stop here. The lane owns CI subscriptions, fix-back, merge authority, merge,
and cleanup.
