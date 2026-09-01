---
name: execute-lane
description: Lightweight lane execution. GitHub is the durable state store; decisions derive only from a small lane file plus fresh git/GitHub observation. Retry-by-default, session-free resume, affected-package local verification, CI as a subscription.
---

# Execute lane

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
merge | cleanup | done | blocked | wait-dependencies`.

Intake from `$create-lane`: a canonical lane v2 ledger is translated with
`init --from-lane-v2 .omo/lanes/<lane-id>.json`, which takes the lane id,
base branch, `confirmed_issues`, and `dependency_graph` edges and ignores
the v1-only DAG/authority fields. A dependency naming an issue outside
`confirmed_issues` is rejected rather than silently dropped. Pass
`--lane-id` to override the inherited id. If the source ledger carries
`predicted_conflicts` entries, read them at init: issues sharing a
non-package surface (governance tooling, CONTEXT docs, shared harness)
will likely need `resolve-conflict` with a keep-both resolution when the
second one rebases — expect it instead of being surprised by it.
A `--from-lane-v2` init also records `source_ledger: { path, sha256 }`
in the v4 lane — the runtime state's back-reference to the exact
planning-ledger bytes it came from (a hand-built `--issue` init has no
ledger, so the field is absent). The hash covers bytes, not parsed
values, so a later ledger edit is detectable.

Multi-layer lanes: `init --issue N` also accepts `--issue N:dep1,dep2`
(deps must be lane members). A dependent issue answers
`wait-dependencies` until every `depends_on` issue is observably
terminal (GitHub issue CLOSED) — release is automatic, observed live,
never journaled. `plan-all` prints every issue's decision in one call.
Only consumer-visible files (not `*.test.ts`, fixtures, or most `*.md`)
count toward the changeset gate, per release governance. Exception: npm
auto-includes package-root `README*` and `LICENSE*` in the tarball
regardless of the manifest `files` field, so those ARE consumer-visible
(proven on #3347 via `npm pack --dry-run`: README.md and README.ko.md
shipped for a `files:["dist"]` package; the old blanket `.md` exclusion
let a README-only change slip the gate until a reviewer caught it).

`watch` closes the dependent-release wake gap: it re-observes the lane
on an interval, prints ONLY decision transitions (e.g. a dependent
flipping `wait-dependencies -> implement` the moment its dependency's
issue closes), and exits 0 with `LANE-SETTLED` when every issue is
`done` or `blocked`. Each tick is a fresh GitHub/git observation —
still no journal, no session identity:

```text
node scripts/lane-v4-cli.mjs watch --root . --lane <lane.json> [--interval 60] [--once] [--stall-after 15]
```

`watch` also prints `STALLED issue <n>: <action> x <ticks> ticks` when a
non-terminal decision has not moved for `--stall-after` ticks (repeating
at every multiple; `0` disables). Transitions-only output reads "no
change" as "no problem", and that assumption broke live: an issue sat in
`review` for hours after a unanimous triad because nothing nudged the
operator to consult `plan`. `done`/`blocked`/`wait-dependencies` never
stall — the last is derivative waiting whose upstream stall fires instead.

The operator (human or agent session):

1. Executes that action (dispatch an implementer child, run scoped checks,
   fan out the read-only review triad, `gh pr create`, `gh pr merge`, ...).

   Triad composition is selective. The merge contract requires one exact-head
   review verdict, not three fixed axes — the lead picks which axes can
   affect the diff. Classification is mechanical and fail-closed: the lead
   reads `git diff --name-only <base>...<head>` ITSELF (never accepts an
   implementer's or child's self-report), assigns every changed file to an
   axis's review scope, and skips ONLY an axis whose scope is provably
   empty:

   | Changed files | code | contract | verification |
   | --- | --- | --- | --- |
   | docs/README/*.md only (no test, no source) | skip | required | skip |
   | tests/fixtures only (no source) | required | skip | required |
   | anything else, mixed, or unclassifiable | required | required | required |

   The axis whose domain IS the changed file type is never skippable:
   a docs-only change is precisely the contract axis's case (a silent
   contract narrowing IS a docs diff), and a test-only change is precisely
   the code axis's case (assertion weakening ships as a test diff). An
   enforcement/guard/governance-tooling change always escalates to the full
   triad regardless of which table row it lands on. When in doubt, run the
   axis — a skipped axis is only ever justified by an empty scope, not by a
   small diff size. Record the chosen axes in the review fact value so a
   stale-head re-review reproduces the same composition.
   Dispatch EVERY issue currently in `implement` as ONE batch of
   implementer children — worktrees isolate them and the engine imposes
   no width limit (a live run held 10 simultaneously; merges serialize
   at the lead regardless, so implement-phase width is pure wall-clock
   win). If the task runner refuses to start a batch, cancel completed
   children to free slots and fall back to sequential spawns — both
   failure modes were observed live and both remedies worked.
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

   Additional verification rules, each earned by a live incident
   (lane-30x10, 30 issues):

   - **Dependency-edge changes need a clean-dist full build.** If the
     branch touches any `packages/*/package.json` dependency field, run
     the full `pnpm build` from a CLEAN dist state. Warm dist masks
     ordering defects entirely: a `runtime -> testing -> runtime`
     workspace cycle passed every local closure build (stale `dist/`
     resolved the types regardless of order) and failed only in CI,
     twice. Closure scope was not the gap — warm dist was.
   - **Classifying a failure as pre-existing requires a control run.**
     Run the SAME command on a clean `main` checkout and record both
     results. One incident classified correctly this way (@fluojs/cli
     7-of-444 local-env failures, main failed 6-of-444 identically);
     one plausible-sounding causation story ("stale merge-base") was
     disproven by a reviewer because nobody had checked whether the
     blamed files had actually changed between the bases.
   - **"Green twice" means two CONSECUTIVE clean runs.** A fail + a pass
     does not satisfy it. Re-run a failing package ALONE to separate
     contention from regression before believing either.
   - **Never run lead commands in a worktree a child currently owns.**
     Two writers in one worktree corrupt both results — the lead's
     evidence binds to a moving head and the child's verification runs
     against files it did not write.
   - **Keep-both conflict resolutions get three extra checks**: (1) both
     sides' functions are still REGISTERED and INVOKED, not merely
     defined — a guard that survives the merge but loses its call site
     keeps every test green while enforcing nothing; (2) the merged test
     count is explained by exact arithmetic (e.g. 146 + 7 = 153), not by
     "it went up"; (3) `grep -rl '<<<<<<<' $(git ls-files)` is empty
     after EVERY `rebase --continue`, not just at the end.
   - **Receipts must be literally true.** A manual demonstration is not
     an automated regression — write "proven by hand, not pinned by a
     test" when that is the truth. "My patch is unchanged" is not "these
     files are unchanged" after a rebase. Reviewers caught eight receipt
     inaccuracies in one 30-issue run; every correction was recorded in
     the receipt rather than silently amended.
2. Records the outcome: `record --phase <p> --result-json '{"ok":true}'`
   (or `ok:false` — retry accounting), and semantic facts bound to the
   exact head: `set-fact --kind local-checks|review --head <sha> --value ...`.
   A new head silently invalidates stale facts — exact-head review is
   preserved with zero ceremony.
3. Runs `plan` again. Repeat until `done` or a typed `blocked`.

Child hygiene rides the `cleanup` phase, not a periodic sweep. Completed
children are two things at once: dead weight on runner slots (three bulk
cancels of 69, 58, and 32 children were needed in one 30-issue run after
spawns started failing) AND live revival channels — `task_send` to a
finished child resumes it with context intact, which powered 6+ reviewer
re-adjudications (block withdrawals, re-verdicts at new heads) at 2-6
minutes each instead of a fresh triad. A CANCELLED child cannot be
revived, so timing is the whole rule:

| Child | Cancel when | Why |
|---|---|---|
| implementer / fix-back | right after the lead verifies its commit | a revived implementer does not redo work (observed: 5 children re-reported "done" with unchanged heads); fix-backs go to FRESH children anyway |
| reviewer (triad axes) | only when its issue reaches `done` (merged + cleaned) | until then it is the re-adjudication channel — cancelling it converts every future dispute into a full re-review |
| probes, one-shot helpers | immediately | single-use |

So the `cleanup` phase for an issue ends with: remove worktree, delete
branches, `record --phase cleanup`, and CANCEL every child that belonged
to that issue. Slots then drain at the pace issues settle instead of
accumulating until the runner refuses new spawns.

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
node --test .agents/skills/execute-lane/scripts/lane-v4.test.mjs
```
