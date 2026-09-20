---
name: verify-local
description: Run pre-PR local CI only after selected reviews pass at the current head and preflight contract; return captured evidence without reviewing, pushing, or orchestrating.
---

# Verify local

This stage belongs to `execute-lane`. The lead owns verification and its
receipt. This stage follows selected review PASS, not the other way around.
The verification reviewer has already assessed focused tests and coverage.

## Input and authority

Require lane/issue identity, the accepted preflight, absolute implementation
worktree, base and current head, selected-axis PASS, and lead-observed changed paths.
Run lane `plan` and require `verify-local` for that exact head. Confirm
the worktree is clean at that head and no implementation child still owns it.
Run checks only; do not edit source, commit, push, mutate a PR, or merge.

## Verification

Read the preflight verification criteria, then use the existing canonical
runner from the assigned implementation worktree:

```text
pnpm verify:local --plan --base-ref <base-ref>
pnpm verify:local --base-ref <base-ref>
```

The plan is determined by `tooling/ci/local-verification.mjs` and
`tooling/ci/local-verification-manifest.json`, not a hand-picked substitute.
It includes install, build, typecheck, tests, lint, platform governance, and
applicable companion checks. `--plan` is inspection only, not passing evidence.
Subscribe to the runner's completion rather than polling. Remote CI still
checks runner/platform and aggregation behavior unavailable locally.

- Do not omit manifest-required checks because a review axis was skipped.
- Build before typechecks; emitted workspace declarations resolve from dist.
  Honor the plan's clean-dist step so warm output cannot hide ordering defects.
- Include any additional acceptance-specific checks required by preflight,
  retaining their evidence separately from the canonical receipt.
- Exercise changed CLI/API/library/UI behavior through its real surface.
- A pre-existing-failure claim requires the same command on clean `main`.
- Capture individual command exit codes; do not pipe a verification command
  through `tail` or `grep` and treat that pipeline's status as success.
- Use event-driven tests, not fixed sleeps. A failing check is not evidence
  of a pass; retain red/green and any baseline evidence accurately.
- If two clean runs are required by the contract, they must be consecutive.
  Re-run a failing package alone to distinguish contention from regression.
- After conflict resolution, check that both sides' retained functions remain
  registered and invoked, account for merged test counts, and scan tracked
  files for conflict markers after each rebase continuation.

## Output and stop

The runner writes `.omo/verification/<head>.json` and command logs. Use those
files, not a hand-authored passing receipt. The CLI validates their hashes,
command plan, and current checkout identity. Keep real-surface observations,
baseline comparisons, and acceptance-specific evidence alongside them.
Re-check the head, accepted policy, and worktree before recording success;
changes invalidate the run.

Use the `execute-lane` CLI's `local-checks` fact and receipt validation path,
not a child-authored `ok: true` as proof. On failure return failed evidence to
the lane; it decides fix-back. Stop after recording the current-head result.

For a passed run, supply `status: "passed"`, `valid: true`, the receipt's
worktree-relative `receiptPath`, and SHA-256 of its exact bytes as
`receiptSha256` to `set-fact --kind local-checks --head <sha> --value <json>`.
The CLI binds it to the current review and rejects execution that started
before that review was accepted.

For a failed run, do not try to register a passing receipt. Record:

```text
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs record --root <repo-root> --lane <lane.json> --issue <n> --phase verify-local --result-json '{"ok":false,"head_sha":"<reviewed-head>","evidence":"<failed-receipt-or-log-path>"}'
```

The lead retains the failed output and translates concrete failures into
canonical fix-back blockers. The CLI binds failure to the current head and
review so `plan` selects fix-back; an old-head report is rejected. A new review
clears the failure and requires local CI again.
