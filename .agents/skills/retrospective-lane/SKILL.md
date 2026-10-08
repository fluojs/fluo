---
name: retrospective-lane
description: Evidence-backed Fluo lane retrospective. Continuously retain work-unit reviewer blockers, implementer/fix-back outcomes and exact CI run/job failures outside execution ledgers; at lane completion, analyze bottlenecks and propose workflow improvements once.
---

# Lane retrospective

This is a reporting stage under `$execute-lane`, not an execution orchestrator,
a review gate, or permission to change code, rules, CI, models, or remote state.
The lead invokes it automatically after every issue's fresh v4 decision is
`done`. A user can also request the same retrospective for a finished lane.
PR merge is a collection checkpoint, not a full-analysis loop per PR.

## Continuous work-unit recording

Use the existing v4 CLI from the repository root:

```text
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs retro-record --root . --lane <lane-v4.json> --issue <n> --kind review --value-file <reviewer-envelope.json>
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs retro-record --root . --lane <lane-v4.json> --issue <n> --kind implementer --value-file <implementer-result.json>
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs retro-record --root . --lane <lane-v4.json> --issue <n> --kind incident --value-file <adjudication.json>
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs retro-ci --root . --lane <lane-v4.json> --issue <n>
```

Record every individual reviewer response **before** aggregation or rejecting
stale/malformed envelopes. Record unsuccessful implementer responses before
fix-back or redispatch, not only the final success. Include actual task identity,
reported head, model/route and measured duration/token usage when available,
failed command and raw log/receipt paths. Do not invent missing values.
For a non-JSON return, retain its raw text, parse error and source identity
inside a JSON observation rather than fabricating a valid review envelope.

Existing `record` automatically stores stage outcomes and attempt-counter
snapshots; review `set-fact` stores the input independently of acceptance.
CI history is captured at merge/fix-back, and on a watch transition to CI
fix-back. The lead also calls `retro-ci` when a CI failure notification arrives,
before starting remediation. Run attempts are queried separately; failure,
timeout and cancellation retain their original conclusions.

Records live under `.omo/retros/<encoded-lane-id>/issue-<n>/events/`, **not**
`.omo/lanes/` or `.omo/lanes-v4/`. Their stable content identity deduplicates
replayed observations. They do not supply PASS, approvals, stage identity, or
the next execution action. Later success never overwrites an earlier blocker.
Keep this root outside issue worktrees so cleanup cannot erase it.

## Lane-end analysis

1. Read `references/analyst.md`.
2. Run `retro-plan` with `--root` and `--lane`. `wait-lane` means continue normal
   execution. `done` means the same completed merge set already has a report;
   return it without dispatching another analyst.
3. For `retro`, run `retro-evidence` with the same arguments. Capture its JSON
   using `apply_patch` in the retrospective directory. The collector includes
   observations, original fact/attempt snapshots, source references and unique
   CI failure patterns. Follow referenced verification/archival receipts when
   needed; do not reread gigabytes of raw traces by default.
4. Dispatch **one** background, read-only `fluo-retrospective` agent using
   `subagent_type: "fluo-retrospective"` and `run_in_background: true`. Pass the
   captured evidence path and lane/subject identity; the project-local agent
   reads `references/analyst.md` as its analysis contract. The agent only reads
   evidence and returns a report; the lead and CLI own recording and storage.
   No product checkout, full CI, or reviewer panel is required for this stage.
   The agent is registered in the project `.omo/omo.jsonc`. If the current
   session does not expose it yet, reload the project configuration before
   dispatch; do not silently replace it with a category worker or mark the
   retrospective complete without its report.
5. Validate the analyst's source links and distinguish confirmed observations,
   causal hypotheses, reviewer claims, and unknowns. Invalid analysis returns
   to the same analyst; it does not reopen a merged issue or rewrite evidence.
6. Save its JSON with `apply_patch`, then pass it to `retro-report` using `--value-file`.
   The CLI binds it to the current completed merge set, checks event references,
   writes JSON/Markdown, and leaves the execution ledger untouched.
7. Return the report path and strongest supported improvement candidates.
   Applying improvements is a separate, scoped implementation request.

```text
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs retro-plan --root . --lane <lane-v4.json>
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs retro-evidence --root . --lane <lane-v4.json>
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs retro-report --root . --lane <lane-v4.json> --value-file <analyst-report.json>
```

## Evidence and limits

- `recordedAt` and `accepted_at` are observation/acceptance times, not
  implementation start/end. `totalElapsedMs` remains `null` unless a separate
  measured lifecycle contract is introduced; never sum parallel CI, review,
  provisioning and soak timings into total work time.
- Attempt counters reset and observations deduplicate. Describe distinct
  recorded outcomes, not a complete execution-count history.
- Reviewer BLOCK is a claim. Verify its cited checkout/symbol and lead
  adjudication before calling it an implementation defect. Missing tools/input,
  false blockers and genuine regressions are different bottlenecks.
- CI job names and failing steps are facts. Test-level root causes require
  actual logs or reproductions; cancelled peers and timed-out watchers are not
  test failures.
- API gaps, pre-recorder history and absent receipts remain explicit unknowns.
  No history or any recorded collection gap requires a partial report.
- Preserve numeric FAIL/INCONCLUSIVE, interrupted runs, waivers and approved
  deferrals. Recommendations never silently upgrade a quality verdict.

The report is complete when each finding links recorded evidence, proposed
changes identify an existing protection and a focused verification, unknowns
are explicit, and repeated completion observations return the stored report.
