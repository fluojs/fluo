# Execution operations

Run commands from the repository root; resolve reference paths relative to this file.

## Files and intake

- `../scripts/lane-v4.mjs`: pure next-action engine.
- `../scripts/lane-v4-cli.mjs`: observation, validation, and persistence.
- `.omo/lanes-v4/<lane-id>.json`: execution state.

Run commands from the repository root using the full script path:

```text
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs init --from-lane-v2 .omo/lanes/<lane-id>.json
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs plan --root . --lane <lane.json> --issue <n>
```

The v2 ledger supplies the lane id, base, confirmed issues, dependencies,
merge grant and approved `retry_policy`. Its source path and byte digest remain
provenance. External issue dependencies are rejected. Read predicted conflicts before dispatch.
Hand-initialized lanes need an explicit merge grant; importing a ledger does
not authorize expanding its issue set.

An imported `retry_policy` must contain exactly `retry_count_is_terminal`,
`max_same_failure_repeats`, `max_wall_clock_minutes` and
`stop_on_child_contract_error`. The terminal flag is boolean and the stop flag
is exactly true. Both limits must be positive integers, or both null with the
terminal flag false. Invalid policies raise `TypeError` before any lane is
created. The pure engine applies the same validation before handling any result;
a missing or nonnumeric bounded limit never becomes unlimited retries.

`init` rejects an existing lane file, for both explicit issue specs and v2
intake, preserving its bytes. It never resets an active lane. State writers
(`record`, `set-fact`, `approve-merge`, `clear-blocker`) serialize the entire
read/validate/update operation with a per-file exclusive lock and publish complete
JSON atomically. Readers can continue during a write. Node's built-in SQLite
holds an OS-owned write transaction on the persistent `.lock` file, with a
60 second contention timeout that fails without changing lane state. The OS
releases a killed writer's ownership, so subsequent writers recover without
deleting the lock file or stealing ownership from a live process. Concurrent
recovery contenders serialize through that same OS lock; no PID reuse or
elapsed-time guess determines ownership. Lane data remains JSON, not SQL.


### Registered dispatch and admission

Use the returned `dispatch` as the native task route (`subagent_type`), with
`run_in_background: true`. `preflight` selects `fluo-issue-preflight`;
`implement` and every `fix-back` select `fluo-issue-implementer`. A `review`
decision maps each effective axis to `fluo-contract-reviewer`,
`fluo-code-reviewer`, or `fluo-verification-reviewer`. Review preparation puts
the same route on `reviewers[i].dispatch`, leaving `common` identical.
Retrospective analysis selects `fluo-retrospective`. These six agents are
registered in `.omo/omo.jsonc` and read their own role reference first.
`../scripts/dispatch-targets.mjs` supplies routing values, shared registration
reading and validation. The JSONC configuration and its own `agents` map must
be plain objects. A registered name is an own key with a plain-object definition
(including null-prototype maps); inherited keys never count. Missing, unreadable
or structurally invalid registration produces `dispatch-registration-unreadable`.
A missing or invalid agent entry produces `dispatch-target-unavailable`. Both
are typed input-preparation blocks with `fix_back_eligible: false`.

Observation stays independent of registration: `plan`, `plan-all` without
`--with-retro`, and `watch` while work remains keep working with unreadable
configuration. Their intended `dispatch` metadata is not an availability check.
Preparation, success admission and a new retrospective analysis request validate
registration. When every issue is done, `watch` can therefore exit nonzero with
the typed JSON block while preparing `RETRO-READY`; readable registration retains
the existing output and exit behavior. Existing retrospective reports remain
reusable without reading registration again.

The lead binds actual child routing to the new `record` success wrapper:
`{ok:true, agent:"fluo-issue-preflight", ...}` or
`{ok:true, agent:"fluo-issue-implementer", ...}`. Keep the preflight artifact,
implementer `Result`, and effective policy digest unchanged. Review `record`
successes include `{ok:true, head_sha, preflight_sha256, active_axes, reviews}`;
every envelope includes the assigned `agent`. `set-fact --kind review` applies
the same strict new-input admission. Missing, wrong-axis, unregistered, or
category substitute identity cannot record success. Keep raw failures as
retrospective evidence under the existing retry contract.

If a target is unregistered or cannot run, do not use a category worker.
Record the lead's observation as
`{ok:false,error:{kind:"input-preparation",code:"dispatch-target-unavailable",
subagent_type:"<assigned target>",fix_back_eligible:false}}` for that phase.
This parks it as `input-preparation` without an implementation retry; restore
the route and clear that phase's blocker before planning again. It is never a
reviewer product BLOCK or an implementation fix-back.

Stored canonical review facts without `agent` retain their original validation,
content, `accepted_at` and local-check/waiver bindings. Only stored-fact reading
allows this legacy shape; new `record` and `set-fact` inputs require identity.
Dispatch metadata never enters accepted preflight or effective policy digests.

`obs.reviewRetention` is derived solely from canonical stored PASS plus Git:
both merge-bases against immutable origin/base, both `--no-renames -z` authored
diffs, their union intersected with the head delta, and raw non-prose blob
SHA-256/mode comparisons. The full policy/floor/digest remain unchanged;
`freshReviewAxes` and review dispatch describe only fresh work. Contract is
always fresh. Closed explanatory-role classification excludes instruction,
governance, generated and machine-read Markdown. Unreadable or uncertain
observation means no reduction. `record --phase review` and
`set-fact --kind review` use the same derived proof and reject caller claims.
Stored optional `retention` follows the exact shape in `review-head/SKILL.md`,
preserving original PASS, identities, acceptance time, comparison coverage and
every nested hop. Observation reauthenticates it against Git. Preparation
independently checks fresh dispatch and complete evidence. New-head local
checks/waivers and full remote CI are never inherited through retention.


### Workflow input preparation

`../scripts/workflow-preparation.mjs` is the runnable preparation entry, not
another orchestrator. Before the preflight child, run its `preflight` mode and
pass the authenticated source-footprint sidecar into that stage. After the
existing engine returns `review`, materialize the exact-head checkout and run
its `review` mode with fresh observations, complete authored diff and the
accepted focused-evidence inventory. The schemas and artifact references live
in `../../issue-preflight/SKILL.md` and `../../review-head/SKILL.md`; executable
validation lives in the preparation source. Reuse the accepted contract and
canonical `obs.preflightPolicy`; do not alter engine actions or ledgers.

New `preflight` inputs require complete `caller_searches` at the pinned base;
the preparer authenticates repository-wide fixed-argv Git results, including
tooling and governance fixtures. The read-only child returns `contract_input`
and rationale, without a digest or dispatch identity. Run
`workflow-preparation.mjs finalize-preflight <input.json>` with exactly
`{version:1,stage:"finalize-preflight",root,footprint,contract_input}`.
The raw authenticated footprint binds the same issue/issue digest/base.
`contract_input` excludes `sha256`, `dispatch` and `agent`, and declares one
`validation_requirements` entry per validation string. Success returns
`{status:"prepared",kind:"preflight-contract",contract}` without registration
or writes. The lead records this artifact with child identity outside its digest.

Before implement or fix-back dispatch, run `workflow-preparation.mjs implement
<input.json>` with exactly `{version:1,stage:"implement",root,
accepted_contract_path,contract,input}`. Use absolute repository root and
authoritative accepted-contract path, the complete accepted contract and the
unchanged issue-implement Input. It checks contract equality/binding, realpaths,
Git common directory, exact branch/starting HEAD and clean status. PR remote
observation stays with the lead. Success returns `{status:"prepared",
kind:"implement-input",dispatch,input,contract,prerequisites}` using the registered
implementer for either input mode.

Local requirements name executable tools with absolute `path_dirs` plus inherited
PATH, and safe worktree-relative file/directory artifacts, including dependency
directories and concrete dist files. The preparer only checks executable access
and artifact existence/kind; it never runs tools or interprets commands. The lead
must provide the declared PATH and complete required install/build work before
dispatch. All missing items name their command in the input block. CI-only
requirements are returned separately and never marked locally passed. Legacy
contracts without requirements return `prerequisites.status:"undeclared"` without
inference, rewriting or a PASS claim. Legacy footprints retain their original
digest. Fix preparation failures at the input/environment boundary, returning to
preflight for a real contract conflict.

Review takes the raw `prepared.footprint`, never the entire prepared wrapper.
Malformed footprint shapes produce `code:"invalid-source-footprint"` on the
typed error and CLI stderr. Every preparation failure has nonzero CLI exit,
`kind:"input-preparation"` and `fix_back_eligible:false`, without success stdout.
Preparation performs no dispatch, Git mutation, commit, PR operation or ledger write.

Only `status:"prepared"` supplies a dispatch payload. Pass its identical
`common` input to all returned reviewer axes in one background wave.
`kind:"input-preparation"` is an input block, not a reviewer BLOCK or an
implementation fix-back. Correct missing/stale evidence or re-open preflight
for real scope expansion. Independent issue worktrees and their review waves
remain parallel.

For browser reproduction use the existing
`node tooling/ci/react-product-acceptance.mjs capture tooling <absolute-new-output>`
entry. CI and local capture consume the same `productDomainPlan`, package-local
runner/config and prepared normal/form entries. Preserve seed/actions, evidence
paths, original suite coverage, assertions, retries and timeouts. Subscribe
through the host monitor with `persistent:true` until command close, descendant
cleanup and normal deployment restoration. Repository code declares this host
observer requirement; it does not modify workstation monitor defaults.
Observer timeout is missing observation, never a test verdict. Retain failed
and cancelled receipts and restoration results as well as successful ones.

Canonical captures and isolated diagnostics must claim a fresh evidence root
before any affected command spawns. A root with artifacts or an existing owner
marker is rejected without changing its bytes. Child directories inside the
owning canonical run are permitted; an isolated diagnosis never reuses that run.
The existing owned runners retain separate complete stdout/stderr, the combined
log, command metadata and actual close/cancellation state. Their terminal output
is a bounded reference to the retained command receipt, not the raw stream.
Do not rerun a completed command merely to recover clipped terminal output.
The prepared reviewer input includes one identical readable, authenticated index
of actual focused results and packed command/report metadata for every axis.


## Decision loop and recovery

1. Run `plan` (or `plan-all`) using fresh observations.
2. Execute exactly the returned action. Independent ready issues may run in
   parallel worktrees; selected review axes dispatch as one background batch.
3. Validate and record outcomes through the CLI. A child `ok: true` is
   completion telemetry, not a replacement for contract/head-bound evidence.
4. Run `plan` again until every issue is observably done or has a typed
   blocker requiring a decision.

Failed children requeue under the imported retry policy. Adaptive policies
(`retry_count_is_terminal: false`) retain attempt counts, repeated failure counts
and elapsed milliseconds as telemetry, without stopping fixable work at either
limit. Bounded policies enforce `max_same_failure_repeats` for consecutive equal
failure payloads and `max_wall_clock_minutes` from the phase's first failure.
Failure identity uses `result.error`, then `result.failed_command`, then the
result itself. `stop_on_child_contract_error` parks malformed results (no boolean
`ok`) and explicit `error: {type: "child-contract-error"}` (even with `ok: true`) as
`child-contract-error`. A success resets only that phase's attempts and telemetry.
Existing v4 files with absent or null `retry_policy` retain the legacy ceiling
of 3, including retrying malformed results. Stored null remains null; no migration
is needed. Every non-null policy retains strict validation.

`record` persists a child-contract-error policy outcome and its raw stage event
without admitting phase evidence, including for `resolve-conflict` and
`verify-local`. Ordinary stage results still require their existing head and
evidence bindings, even when a prior contract-error blocker is already present.

An exhausted attempt budget is resumable; never hide failure as success. Preserve
the same issue/branch/worktree/optional PR during fix-back. Use a fresh implementation
child for remediation, carrying canonical blockers and accepted preflight.

To explicitly resume a parked phase, use:

```text
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs clear-blocker --root . --lane <lane.json> --issue <n> --phase <blocked-phase>
```

The phase must match the current blocker's phase. This clears that blocker and
resets only that phase's attempts and retry telemetry, preserving all other
issues, facts, approvals and counters. It appends an `incident` with
`action: "clear-blocker"`, a fresh `operation_id` and the removed blocker to the
existing retrospective store, retaining every clear even after identical repeated
exhaustion. Run a fresh `plan` afterward; clearing a blocker supplies no passing
evidence or additional authority.

Required PR, issue and dependency GitHub observations fail closed.
`plan` and `plan-all` return the `observation-failed` action with
`failures: [{source, subject, code}]`, where source is `pr`, `issue` or
`dependency`, and code is `command-failed` or `invalid-response`. `watch`
uses the same decisions and emits the matching action transition.
The explicit `gh pr view` no-pull-request outcome remains a successful absence;
authentication, network and other errors cannot become absence or changed issue
content. Failed observations authorize no stage action, including preflight,
implementation or PR creation. Restore observation access and plan again;
watch reports the transition and continues observing rather than settling it
as a policy blocker.

Dependencies release from fresh GitHub issue-closed observations, not task
completion. Use the CLI `watch` through a monitor to receive transitions and
stall notices. OPEN PR CI passes only when the rollup satisfies its success
conditions and the latest exact-PR-head run of `.github/workflows/ci.yml` is
`completed/success`. Select by workflow path and latest run id, not the display
name or check count. A successful current rerun attempt also satisfies this run
condition; earlier failed attempts remain supplementary retrospective history.
Unavailable, malformed or incomplete Actions observations, a missing canonical
run, and unfinished runs leave the PR waiting. Rollup failures and completed
failed runs still require CI fix-back.

For `wait-ci` subscribe once to `gh pr checks --watch`. It can finish between
registration of the initial checks and the remaining jobs, so its exit alone
does not prove CI success. Also observe completion of the current canonical run
through a monitor around `gh run watch <run-id> --exit-status`; when it completes,
run a fresh `plan` to apply both conditions and the existing mergeability and
approval gates.
Disable the GitHub pager in monitor commands (`GH_PAGER=cat`) so an earlier
identity query cannot block the watch inside the terminal pager.
Do not poll from the coordinator or create a child merely to wait.
