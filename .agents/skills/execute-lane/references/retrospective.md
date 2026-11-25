# retrospective

Run commands from the repository root; resolve reference paths relative to this file.

## Retrospective capture and lane completion

For measurements, `record --result-json` accepts optional `measurements` work
units with `{ runId, attempt, stage, head, clock, elapsedMs, scope }`. Stages are
`integration`, `focused`, `browser`, `review:contract`, `review:code`,
`review:verification`, or `ci`; scope is `stage-execution`. Measure actual work
with a monotonic clock, retain unique run/attempt identities, and use
`clock: simulation` only for event fixtures. Unknown durations are null, not zero.
Planning/watch observations separately retain process identity and monotonic
observation times. The retrospective reader computes head-specific stage counts,
superseded validation heads and separate dependency/coordination observed waits;
a restart without an observed wait end remains unknown. Neither `recordedAt`
nor simulation timing proves elapsed execution or a CI budget. Compare identical
initial state, changes, merge/CI schedule, final source and gate coverage, and
report worse or inconclusive outcomes without reducing checks, retries or timeouts.

Marker lanes retain `externalOverlaps` on planning/watch observation events even
without generated hints. `externalOverlapObservations` in `retro-evidence`
lists each event's `eventId`, issue, lane/PR match counts, status and unknowns.
These are observations, not unique conflict counts: repeated polling must never
be summed into a count of distinct collisions. `externalOverlapUnknowns` links
older observation events without this field; missing history is unknown,
not evidence of zero overlaps.

`conflictResolutions` reports issue-level `observedConflictResolutions`, heads
and their supporting `eventIds`. It counts successful recorded
`resolve-conflict` results, deduplicated by actual resulting `result.head_sha`
per issue. Failed stages, observations of a pending action and attempt counters
do not count as successful resolutions. This is an observed success count;
`history: unknown` preserves the possibility of uncollected older successes.
It is separate from measured integration stage executions. Existing retrospective
subject identity, final CI collection requirements and `totalElapsedMs: null`
remain unchanged.

Read `../../retrospective-lane/SKILL.md` when starting or resuming execution. The lead
retains individual reviewer responses before aggregation/adjudication and
unsuccessful implementer returns before retry using `retro-record`. Keep task,
head, model, failed command and actual receipt/log references when available.
Record reproduction/adjudication separately: a reported BLOCK is not proof of
an implementation defect. Success must not overwrite the original incident.

The CLI retains `record` outcomes and review `set-fact` inputs outside the lane
ledger. CI failures are captured by actual run/attempt/job identity. Call
`retro-ci` on a failure notification before fix-back; merge/fix-back recording
and CI watch transitions also capture history. Missing API evidence becomes an
explicit collection gap, never a passing gate or an absent-failure claim.

All CLI `gh` observations run with `GH_PAGER=cat`. Before retrospective dispatch,
fresh PR observations include final-head applicable run/attempt identities.
`collect-ci` / `input-preparation` means retain/recollect the missing final CI
events and refresh observations; it is not product failure or implementation
fix-back. Earlier-head success, earlier attempts and incomplete job collection
cannot unblock dispatch. Older failures remain immutable after recollection.

Use `plan-all --with-retro` for the completion handoff. It preserves the issue
decisions but reports `settled: false` and a `retrospective.action: retro`
until the completed merge set has its report. The legacy `plan-all` array
remains an execution-only interface, not a retrospective completion verdict.
When fresh issue decisions are all `done`, execution is finished but the
completion handoff still includes the one aggregate retrospective. `watch`
emits `RETRO-READY` at that boundary. Follow the retrospective skill's
`retro-plan -> retro-evidence -> fluo-retrospective -> retro-report` flow, then
return the report and strongest evidence-backed improvement proposals.
Repeated observations of the same completed merge set reuse the report.
Legacy execution ledgers remain unchanged and completed issues never reopen
for analysis; missing older history is reported as partial coverage.

## Native stage lifecycle capture

At each background `task` dispatch, retain its returned `task_id` and the
lead's durable parent session ID alongside the lane, issue, and `stage`:
`preflight`, `implement`, `fix-back`, or `review:contract`, `review:code`,
`review:verification`. For a parallel wave retain one binding per returned
task, not one binding for the aggregate. A route or child result is not a
dispatch receipt. If no task ID was returned, report the missing capture as a
retrospective gap; do not mint one.

1. While the child is live, use the installed Senpi RPC `list_sessions`
   (`include_workers: true`) on the existing task host to find its
   `context.task_id`, `durableSessionId`, and `sessionPath`. With the matching
   routing handle, `get_state.lifecycle` can corroborate child role, parent,
   task and engine `runId`. Read the native task-state JSON for that task
   (`senpi-task/tasks/<taskId>.json` in the active project's OMO runtime
   directory). Its live `host_session.session_path` identifies the same
   session file. Preserve the path before the host removes its live handle.
   Routing IDs are ephemeral; do not substitute one for the durable ID.
2. Write a binding JSON file under ignored local evidence storage:
   `{ "stage": "...", "taskId": "st_...", "parentSessionId": "...",
   "taskFile": "/absolute/native/task.json", "sessionFile": "/absolute/native/session.jsonl" }`.
   Use `null` for an unavailable path. Do not copy full prompts, child output
   or auth material into lane evidence. Run:

   ```text
   node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs retro-record --root . --lane <lane-v4.json> --issue <n> --kind stage-lifecycle --value-file <binding.json>
   ```

3. Repeat after settlement, an observed interruption, or resumption for the
   same dispatch. Read the original files or retained byte copies of their
   native records, not the text of a monitor notification. The intake checks
   task/parent/child lineage and captures original file, entry ID, event ID,
   engine epoch and run ID. Durable `session-lifecycle` checkpoints with
   `runActive: true` establish that the named run started. A matching inactive
   checkpoint with `lastTurnEnd` establishes its terminal boundary and
   classification. `since` can predate the run and `observedAt` can be
   restamped on replay; neither nor the JSONL entry timestamp is a numeric
   run clock here. A truncated RPC monitor notification, watcher timeout,
   attempt count, or completion delivery does not replace these checks.

`retro-evidence.stageLifecycle` keeps run boundaries and task attempts separate.
Only an epoch-bound terminal native task record with monotonic `run_stats`
can supply task-attempt elapsed time; it is not engine-run elapsed time. Do not
sum runs, task attempts, CI, or parallel axes into lane elapsed time. An
interruption followed by another run does not bridge the gap between them.
The native transcript does not attest the executed Git head: keep `head: null`,
never borrow a checkout, review-input or result head for this field, and keep
these runs out of the existing superseded-head calculation. Missing and
conflicting sources remain traceable from event IDs and source references; no
verified start means the observed start count is `null`, not zero. Coverage is
partial because these captures do not establish complete lane history.

This command writes only retrospective observations. If capture or storage
fails, preserve the error in lead evidence and continue existing stage-result
recording, final CI capture and gate checks. Success or failure of a host
run is not a review verdict, product blocker or fix-back authorization.

Recommendations do not automatically change workflow, tests, skills, rules,
models, or remote state. Applying them is separate scoped work. All incident
data and reports live in `.omo/retros/`, outside disposable issue worktrees
and separate from `.omo/lanes/` and `.omo/lanes-v4/`.
