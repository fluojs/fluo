---
name: execute-lane-v4
description: Lightweight lane execution. GitHub is the durable state store; decisions derive only from a small lane file plus fresh git/GitHub observation. Retry-by-default, session-free resume, affected-package local verification, CI as a subscription.
---

# Execute lane v4

v4 replaces the v3 issue-DAG protocol with one pure decision engine and a
thin observation CLI. It exists because v3 stalled structurally; each v4
invariant reverses one diagnosed v3 root cause:

| v3 root cause | v4 invariant |
| --- | --- |
| Terminal-by-default (`blocked-child-contract-error` on any anomaly) | Retry-by-default: failed/malformed child results increment `attempts` and re-queue; terminal only at `ATTEMPT_CEILING` (typed, user-resumable) or a genuine policy blocker |
| Session-bound run identity + rollover ceremony | No session identity anywhere: any coordinator resumes any lane from `plan` output alone |
| Globally serialized `pnpm verify` per head | Local verification scoped to affected packages; the full matrix runs on CI |
| CI polling via ordinal DAG amendment nodes | One `gh pr checks --watch` subscription (or a monitor on it) |
| Hash-chained event journal as identity | The lane file stores only intent (attempts, approvals, blockers) and head-bound facts; git/GitHub is observed fresh every `plan` |

## Files

- `scripts/lane-v4.mjs` — pure engine: `decideNext(lane, obs)`, `applyChildResult(lane, phase, result)`.
- `scripts/lane-v4-cli.mjs` — observation + IO: `init`, `plan`, `record`, `set-fact`, `approve-merge`.
- Lane state: `.omo/lanes-v4/<lane-id>.json`.

## Loop

```text
node scripts/lane-v4-cli.mjs plan --root . --lane <lane.json> --issue <n>
```

`plan` observes live git/GitHub, merges head-bound facts, and prints the
single next action: `implement | verify-local | review | fix-back |
create-pr | push | wait-ci | resolve-conflict | request-merge-approval |
merge | cleanup | done | blocked`.

The operator (human or agent session):

1. Executes that action (dispatch an implementer child, run scoped checks,
   fan out the read-only review triad, `gh pr create`, `gh pr merge`, ...).
   `verify-local` MUST build the dependency closure BEFORE typechecks and
   tests — workspace `types` entries point at emitted `dist/*.d.ts`, so a
   bare-filter check on an unbuilt checkout fails with misleading TS2307s:

   ```text
   pnpm --filter '<pkg>...' build   # '...' = package + its workspace deps
   pnpm --filter '<pkg>' typecheck && pnpm --filter '<pkg>' test
   ```

   Never pipe verification commands into `tail`/`grep` inside a `&&` chain:
   the pipe masks the exit code and forges a passing sentinel. Capture each
   command's result individually.

   Scope: changed packages AND their direct reverse dependents' test
   suites (`pnpm --filter '...<pkg>' test` covers dependents). The full
   42-package matrix still belongs to CI — but a seam/export change is
   consumed downstream, and skipping dependents locally just moves the
   fix-back one CI round later (observed: @fluojs/cli typegen/inspect
   broke on a react/runtime seam change that http/react/runtime suites
   could not see).
2. Records the outcome: `record --phase <p> --result-json '{"ok":true}'`
   (or `ok:false` — retry accounting), and semantic facts bound to the
   exact head: `set-fact --kind local-checks|review --head <sha> --value ...`.
   A new head silently invalidates stale facts — exact-head review is
   preserved with zero ceremony.
3. Runs `plan` again. Repeat until `done` or a typed `blocked`.

## Preserved contracts (unchanged from AGENTS.md)

- Implementers write only inside `.worktrees/<branch>`; reviewers are
  read-only; fix-backs go to the same child/branch.
- `merge` is emitted only after: green CI, same-head review verdict
  `merge`, `MERGEABLE` state, and an explicit `approve-merge` grant.
  Without the grant the engine emits `request-merge-approval`.
- Public `packages/*` changes require a `.changeset/*.md` in the branch
  diff before review (`fix-back: changeset-missing` otherwise).
- Publishing stays GitHub Actions + Changesets only.

## Tests

```text
node --test .agents/skills/execute-lane-v4/scripts/lane-v4.test.mjs
```
