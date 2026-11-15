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

Recommendations do not automatically change workflow, tests, skills, rules,
models, or remote state. Applying them is separate scoped work. All incident
data and reports live in `.omo/retros/`, outside disposable issue worktrees
and separate from `.omo/lanes/` and `.omo/lanes-v4/`.
