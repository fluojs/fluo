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
(`record`, `record-review-preparation-blocker`, `set-fact`, `approve-merge`,
`clear-blocker`) serialize the entire
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
every new envelope includes the assigned `agent`, `evidence` and `observations`.
Evidence entries identify checked acceptance with repository-relative
`file:line` locations; a PASS without evidence is rejected. Observations never
affect the aggregate verdict. `set-fact --kind review` applies
the same strict new-input admission. Missing, wrong-axis, unregistered, or
category substitute identity cannot record success. Keep raw failures as
retrospective evidence under the existing retry contract. Independently bind the
actual `taskId` returned by each native background spawn to the lane, issue,
stage (and individual review axis). Follow
[native stage lifecycle capture](retrospective.md#native-stage-lifecycle-capture)
while the child is live and again after settlement or interruption. Telemetry
is best effort: result admission and retries never wait for it.

If a target is unregistered or cannot run, do not use a category worker.
Record the lead's observation as
`{ok:false,error:{kind:"input-preparation",code:"dispatch-target-unavailable",
subagent_type:"<assigned target>",fix_back_eligible:false}}` for that phase.
This parks it as `input-preparation` without an implementation retry; restore
the route and clear that phase's blocker before planning again. It is never a
reviewer product BLOCK or an implementation fix-back.

Stored canonical review facts with the old five or six envelope keys retain their original validation,
content, `accepted_at` and local-check/waiver bindings. Only stored-fact reading
allows these legacy shapes; new `record` and `set-fact` inputs require identity
and both new arrays. Legacy `previous_review` remains unchanged in every
retention hop; partial modern fields and unknown keys are rejected.
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

The unchanged `review <input.json>` command selects bounded file transfer when
the actual inline output would exceed 49,999 UTF-8 bytes or 1,500 lines.
Small inputs keep the original prepared JSON and need no new argument or
decoder. For `kind:"review-transfer"`, preserve the returned transfer reference,
binding and absolute artifact root and pass the identical transfer to all
selected axes with their returned registered dispatch routes. Before dispatch,
use `review-read` to authenticate the manifest and complete unit inventory.
Each reviewer must read every ordered unit without clipping before judging.
The complete protocol, fixed per-file/total limits, manifest authentication,
reader input and reconstruction are in
`../../review-head/SKILL.md#bounded-complete-review-transfer`.
The CLI retains only transfer files, never lane facts or Git changes. It
rechecks accepted contract and checkout/base freshness after retaining them.
Transfer failures are non-fixable `input-preparation`, never product blockers
or partial review success. Preserve the original accepted contract, canonical
plan, source footprint and caller searches, complete authored diff,
implementation/fix-back evidence, required checks, receipt inventory, raw stdout/
stderr and packed evidence admission; transfer does not replace any of them.

Supply review preparation's required `implementation` context with mode
`implement`, `fix-back`, or `resolve-conflict`, previous/current heads and the
accepted contract digest. For fix-back use the actual implementer Result's
`previous_head_sha` and `head_sha`. For executable fix-back the lead runs
`node .agents/skills/execute-lane/scripts/workflow-preparation.mjs fix-back-red <input.json>`
in a separate clean reproduction checkout at that previous head. Supply the
post-head regression-test/necessary-fixture patch, focused command/argv and
assertion location; the command executes and writes full streams plus an
authenticated RED receipt into a new artifact directory. See review-head's
input and receipt keys. Pass its `{path,sha256,bytes}` as `fix_back_red`;
its nested artifacts resolve beside the receipt. Matching current-head GREEN
evidence must retain the same command and argv. Missing, altered, unrelated,
GREEN or setup-failure evidence stops with `input-preparation`,
`fix_back_eligible:false` before reviewers run. All axes receive identical RED
evidence in `common`. For a Changeset-only fix-back, omit `fix_back_red`:
preparation authenticates a single approved top-level regular Changeset addition
with stable `patch` intent for the public package whose root EN/KO README pair
changed in the prior head's authored diff. It emits identical
`common.fix_back_release_metadata` to all axes, never a test receipt. An
invalid supplied RED cannot select this route. The full authored diff,
focused checks, readable index, CI and release obligations still apply.
Ordinary implementation/conflict review needs neither form of evidence. This
limited lead reproduction authority belongs only to review preparation;
issue-implement's `leadAuthority` and every reviewer remain unchanged.

Before executable fix-back dispatch, confirm the permitted runner, complete projected
test/necessary-fixture patch, named body assertion's first source file/positive
line and real corrected-head GREEN using identical command/argv. Node TAP
retains its existing command forms. Packages Vitest uses only the fixed
installed entrypoint, packages project, one projected test file/name selection,
approved reporter and output path, and bounded worker options specified in
`../../review-head/SKILL.md`. Authenticate that entrypoint relative to the
actual execution checkout before spawn, and to the corrected review checkout
when authenticating GREEN. Both must resolve to the preparer's approved
installation; the repository root does not need its own `node_modules`.
Good: separate reproduction/review worktrees link to that installation.
Wrong: trust the root's valid installation while a checkout resolves another
entrypoint. Unsupported regressions stop in preparation;
they do not require a duplicate implementation in another test runner.

For Vitest, use `workflow-preparation.mjs fix-back-green <input.json>` on the
corrected review checkout and pass its returned receipt reference as the
matching focused evidence. Both captures retain the approved reporter's output
as `test_results:{path,sha256,bytes}`. Use a fresh corrected checkout or archive
the previous ignored capture files before a separate run; capture never
overwrites them. Both reports must authenticate
the reporter implementation and prove the selected test ran exactly once.
Only one RED body assertion at the first valid source frame is accepted.
The approved runner traces the test callback after fixture setup, including
assertions after awaited I/O. Setup/module/suite/hook/fixture/unhandled/runtime
errors, unrelated/multiple failures,
wrong file/name/line and incomplete reports fail closed. Successful hooks and
error words in assertion values do not invalidate an assertion. GREEN must
contain the same actually passing selection, with no remaining runner errors.
Substituted executable/entrypoint/reporter/behavior options, stdout lookalikes
and pass-only receipts are not execution proof. Existing binding, complete
patch, raw-stream and final-freshness checks still apply to every axis.

Reserve runner fd 3 as a separate collector pipe for both RED and GREEN
(`stdio:["ignore","pipe","pipe","pipe"]`). The reporter includes the collector's
per-run ID and writes the same bytes there only after its exclusive output-file
write succeeds. GREEN retains both channels and the exact receipt; admission
rechecks them against the independently retained capture in the corrected
checkout. Keep stdout/stderr separately. A worker's lookalike file cannot
replace the completion channel. See review-head for the exact collection
contract.

### Test-only executable fix-back

Classify the complete actual Git delta between the implementer Result's
`previous_head_sha` and corrected `head_sha`, not the submitter's label.
Test/fixture-only changes do not qualify for different evidence. Mixed,
runner/configuration or build-input changes, and uncertain classifications
remain subject to the existing gate.

In a separate, initially clean worktree at that actual `previous_head_sha`,
project only the complete regression-test and necessary fixture changes from
the corrected head. If the named test passes there, the test-only fix-back
cannot proceed: it has not shown that the blocker is reproduced on the
previous head or that the fix-back corrected it. For a regression that does
reproduce, require the supported runner's genuine failure in the named test
body at the required source location and an actual pass of that same
selection on the corrected head with identical command and argv. The pinned
verification base, a product-mutated checkout, a different runner, and setup,
hook, import or runtime failures cannot supply canonical RED.

The lead owns this preparation decision and retains both observed commits and
trees, the complete projection patch, exact runner/selection/command/argv,
outcomes and full raw logs with their provenance in existing work-unit
evidence. Keep a previous-head projection pass as that observation, not a
RED receipt. If a product mutation is used to diagnose test sensitivity,
retain its checkout identity, mutation patch, outcome and logs separately as
diagnostic evidence; verify restoration and keep the corrected review checkout
clean. Mutation failure proves neither previous-head RED nor blocker
remediation and cannot substitute for review PASS.

If the previous-head projection passes and required evidence is unavailable,
stop before reviewer dispatch. Report the evidence gap as `input-preparation`,
`fix_back_eligible:false`, not a new product verdict or fix-back retry. Preserve
the original required canonical blocker's identity, evidence and unresolved
status separately. Refer it and the retained observations to the maintainer for
blocker/scope adjudication; return to preflight if approved scope must change.
Do not mark the blocker remediated or treat the work as complete, reviewed or
publishable on this evidence. Local Result admission does not satisfy this gate.

Only independently extra coverage may be separately approved and scoped as
ordinary implementation, after original acceptance and review are satisfied
without that coverage or mutation evidence and no required blocker remains.
Do not relabel the existing fix-back, waive evidence, or introduce another
evidence path. The bounded Changeset-only Git evidence above is unchanged and
does not apply to tests or fixtures.

### Implementation and review input details

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

Immediately after an implement or fix-back child returns, before any success
`record` or review preparation, run `workflow-preparation.mjs implement-result
<input.json>`. Always run it, including when no Result was returned. Its exact
wrapper is `{version:1,stage:"implement-result",root,accepted_contract_path,
contract,input,result}`. Paths are absolute; contract and Input are unchanged;
`result` is the original version 1 Result or `null`. API callers use
`prepareImplementResult(wrapper)`. Do not run starting-HEAD preparation again
on a newly committed implementation.

The read-only gate authenticates accepted-file equality, issue/preflight,
worktree realpath/common repository, branch, starting ancestry and current HEAD.
It compares the nonempty committed diff and approved scope against changed_files,
rejects staged/unstaged/untracked residue, and observes running commands using
actual cwd and system-wide parent relationships. On macOS it uses `ps` and
`lsof`; on Linux it uses `ps` and `/proc/<pid>/cwd`. Cwd roots cover the current
effective user's commands, with descendants attributed through the full process
table even when they change directories. Run the lead and child under the same
user. Paths use component boundaries; sibling worktrees are excluded. The
checker itself is excluded. Missing cwd for a still-live process, failed tools,
unreadable observations and unsupported platforms fail closed, never as an
empty process list. This is a point-in-time observation, not a process lock.

Success returns `{status:"accepted",kind:"implement-result",result}` (CLI stdout,
exit 0) with the original Result unchanged. Only then pass that Result into the
existing `{ok:true,agent:"fluo-issue-implementer",...}` success record and use a
fresh plan for review preparation. Passed focused verification remains child
self-report; admission does not independently execute or certify tests.

Ordinary unfinished work returns `{version:1,status:"incomplete",
kind:"incomplete-run",lane_id,issue_number,mode,preflight_sha256,worktree,
starting_head_sha,current_head_sha,branch,changes,result,processes,reasons}`
(CLI stderr, exit 2, no success stdout). `worktree` is the real path;
`changes` contains `staged`, `unstaged`, `untracked` path arrays. `result` is
`{present,valid,error}` with `error:null` unless validation failed. Each process
has `{pid,ppid,command,attribution}`; attribution is `{kind:"cwd",path}` or
`{kind:"descendant",ancestor_pid}`. Reasons retain every observed cause:
`missing-result` or `invalid-result`, `running-processes`, `unchanged-head`
(or `empty-diff` for a new commit with no tree change), and `dirty-worktree`.
No Result is inferred even for a clean new commit.

Retain the complete incomplete-run wrapper and raw child return in work-unit
evidence, without publishing an implementation success fact or starting review.
Monitor the listed existing commands to their actual exits, then resume the
same child/assignment with its branch, starting head, contract, dirty work and
optional PR intact. Do not rerun commands, terminate processes, auto-commit,
automatically retry, or synthesize missing evidence. Run completion admission
again when the resumed assignment returns. Binding mismatches and observation
failures instead throw/emit `kind:"input-preparation"`,
`fix_back_eligible:false` (CLI stderr, exit 1). Unobserved values remain
unavailable in that diagnostic; never guess them or turn an unavailable probe
into incomplete-run. Restore input/observation access before continuing.
Neither wrapper changes Result, exported issue-implement validators,
implementerAuthority/leadAuthority, old facts/digests, engine decisions, Git,
ledgers or remote state.

Local requirements name executable tools with absolute `path_dirs`, and safe
worktree-relative file/directory artifacts, including dependency directories and
concrete dist files. Without a PATH assignment, tools are searched in `path_dirs`
followed by inherited PATH. A leading `PATH=... cmd` or `export PATH=...; cmd`
instead uses only that command's PATH, in order; `path_dirs` never adds directories
to it. Literal single/double quotes are supported, including spaces inside quotes.
Unquoted or double-quoted `$PATH` (also `${PATH}`) expands inherited PATH exactly
at that position; single-quoted `$PATH` stays literal. Relative/empty PATH entries
resolve from the assigned worktree.

The non-export form supports one simple command only. A following unquoted
command boundary (`&&`, `||`, `;`, `|`, `&`, newline or grouping) is unsupported:
`PATH=/cmd-tools pnpm --version && node check.mjs` cannot apply that PATH to
both tools. Use `export PATH=/cmd-tools; pnpm --version && node check.mjs`
for a persistent PATH. Quoted operator arguments such as `pnpm '&&' ';'`
remain ordinary literals.

Good: `PATH=/opt/node/bin:/opt/pnpm/bin:$PATH pnpm test:node` or
`export PATH="/opt/node/bin:/opt/pnpm/bin:$PATH"; pnpm test:node`.
Good literal replacement: `PATH='/opt/node/bin:/opt/pnpm/bin:/usr/bin' pnpm test:node`.
Wrong: `PATH=/opt/node/bin pnpm test:node` with pnpm available only in inherited
PATH or declared `/opt/pnpm/bin`; preparation blocks the missing tool and names
its command. Wrong: `PATH=$(find-tools) pnpm test:node` or `PATH=$HOME/bin pnpm test`.
Command/backtick substitution, other variables/parameter operations, unquoted
tilde/glob expansion, escapes, malformed quotes, wrapped/later or multiple PATH
assignments are unsupported and produce `kind:"input-preparation"`,
`fix_back_eligible:false`, not an inherited-PATH success.
The same block applies to wrapped env resets: `env -u PATH pnpm test`,
`env --unset=PATH pnpm test` and `env -i pnpm test` (including `--unset PATH`,
`-uPATH`, `--ignore-environment` and `env -`). These cannot fall back to
declared or inherited tools. Ordinary arguments such as
`pnpm 'env -u PATH' '-i'` and `env -u OTHER pnpm 'PATH='` remain ordinary
non-PATH-modifying contexts.
Short env option groups are scanned in order: `-vi` and `-iv` also reset PATH.
`-u` consumes its attached or following name, so `-vuindirect` does not treat
the name's `i` as a flag. Unknown env options receive the same typed block;
for example, `env --chdir /tmp -i pnpm test` is rejected without interpreting
the option's operand.

This is filesystem inspection and static string parsing only: the preparer
checks executable regular files and artifact existence/kind without running the
validation command, declared tools, a shell or command substitution. The lead
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
These preflight, finalization, implement and review modes perform no dispatch,
Git mutation, commit, PR operation or ledger write.

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

### Declared production inputs

Use the owning [release contract](../../../../docs/contracts/release-governance.md#production-input-declarations)
and `tooling/governance/package-production-inputs.json`. The CLI and existing
governance runner share `package-production-inputs.mjs`; no build executes during
plan. Read the actual issue head and comparison base, not dirty files or the
engine checkout. Declared root/tooling/sibling inputs and packed payloads precede
test/fixture/Markdown names and explicit nonshipping rules.

Package/build owners review complete reader/transitive-input scopes, including
computed paths, and refresh command/producer/config definitions when they change.
Structural validation is not code-dependency analysis. Invalid, stale, deleted
or narrowed evidence remains consumer-visible and fails governance. A new
declaration cannot exempt a diff against an undeclared old base; retain the pinned
base/engine and reconcile preflight through the normal post-merge process.
Validate with `node tooling/governance/package-production-inputs.mjs` and
`pnpm verify:platform-consistency-governance`, retaining actual receipts.

### CI Node concurrency before review

Preflight records applicability and cost in acceptance and validation after
inspecting `package.json`'s `test:node`, its tests, called implementation,
fixtures and shared helpers. Changes affecting long-running work, subprocesses,
watches, locks, external observations or resource contention on that path are
included; uncertainty is included. A procedure-only document with no execution
path effect can be excluded with inspected evidence, never by extension alone.

For every applicable implementation, fix-back or conflict-resolution head, the
lead completes focused checks, then runs the original `pnpm test:node` before
review preparation/dispatch. Complete declared install/build prerequisites
first. Preserve the script's entire file set and default inter-file concurrency.
Do not substitute split commands, `--test-concurrency=1` or individual passes.
Record the actual Node executable and `node --version`, pnpm version, OS/arch,
relevant environment and concurrent work/resource load conditions with the
run's output or an accompanying incident. Use the declared primary runtime,
not the machine default; a host run does not establish canonical container or
remote CI parity. Do not run while another child writes the same worktree.

Put the actual command string, including its declared PATH prefix, in existing
`required_checks` and the matching `evidence[].command` and receipt `command`.
Retain the existing receipt's `version`, `complete`, exact `head_sha`,
`tree_sha`, `contract_sha256`, `status`, `exit_code`, `signal`, monotonic
`duration_ms` and full stdout/stderr artifact references. Use review
preparation's authenticated `common` and `readable_index` unchanged for every
selected axis. No optional CI-evidence field, receipt/contract schema, duration
threshold, comparison helper or engine action is added.

The lead supplies missing or stale-head evidence before dispatch; this is
`input-preparation` with `fix_back_eligible:false`, not a product defect.
Preserve actual failed, timed-out or cancelled executions and original logs
as incident evidence; they cannot be submitted as passing receipts. An
unresolved current-head command failure remains blocking under the existing
local-failure/fix-back boundary. A split success or new review PASS cannot erase
it. After remediation, keep the earlier incident and obtain a completed
passing original-command receipt on the corrected head before review.
An observer timeout alone remains missing observation, not a command verdict.

This selected command is an acceptance-specific pre-review check, not full
canonical local CI. `pnpm verify:local` remains available only for explicitly
requested post-review reproduction/diagnosis; final remote CI and merge gates
remain unchanged.

### Timeout cause diagnosis and corrections

Record the first cause attribution as a hypothesis alongside the original
incident, head, command, actual elapsed time, exit/signal and complete logs.
An increase in test duration is an observation, not proof that the change is
the sole cause of a timeout. Review existing `duration_ms` and reporter output
without inventing a threshold or interpreting a passing status as no slowdown.

Before confirming a cause, compare a clean comparison base and the problem
head with the same original command, exact Node executable/version, completed
install/build preparation, environment and concurrent-work load conditions.
Keep both comparison commits, commands (including PATH), runtime and pnpm
versions, preparation, environment/load observations, actual durations,
exit/signal and full logs. Use separate clean checkouts and evidence roots;
do not replace the accepted verification base or reuse a stale receipt.
If conditions cannot be matched or results do not support a difference,
retain `hypothesis` or record `inconclusive`. Even a matched comparison showing
a difference does not automatically establish a sole cause: evaluate contrary
observations and competing explanations before recording a confirmed claim.

For example, a timeout in the original concurrent command followed by a passing
isolated watch test is diagnostic evidence only. Compare the original command
on base and head under matched runtime/load; if both pass, that observation
does not establish which change caused the earlier timeout. Retain isolated or
split diagnostic runs separately from original concurrent runs. Never weaken
assertions, timeouts, retries or execution scope to manufacture success.

Append corrections linked to the original incident rather than replacing it.
Retain the initial attribution, supporting and contrary runs, corrected claim
and remaining uncertainty together. In particular, do not reuse the
pre-correction #4130 cause wording in `overlap-measurements.json` as established
fact; read its accompanying correction evidence. Increased duration and proof
of a timeout's sole cause are distinct claims.

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

### Release a review grant when prior-head RED is unavailable

Only the lane lead may record this input-preparation blocker, and only when
official review evidence preparation fails because the required prior-head RED
cannot be established. In a `preflight_overlap: 1` lane, use an actual returned
`review` grant. Copy the review head and effective `policy_sha256`
(`obs.preflightPolicy.sha256`), and the positive safe-integer sequence from
`obs.facts["review-readiness"].value.sequence` on that `plan` row. The command
accepts only the following five JSON fields:

```text
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs record-review-preparation-blocker --root . --lane <lane.json> --issue <n> --value '{"reason":"prior-head-red-unavailable","fix_back_eligible":false,"head_sha":"<head>","policy_sha256":"<policy>","sequence":<sequence>}'
```

The command re-observes the checkout and GitHub under the lane lock and
requires that exact grant to still be eligible for coordinated `review`. An
OPEN PR at an older head is allowed; an already published current head is not.
The blocker and the deactivated grant are saved together. The command allocates
no sequence and consumes no retry or fix-back attempt. An exact replay on the
same live binding is a no-op; a stale request or a different blocker is an
error. Do not edit the ledger or simulate a stage result to release a slot.

Retain the failed preparation evidence and any separate unresolved product
blockers. A diagnostic mutation is not official RED, and this command supplies
neither a RED waiver nor admission to review, publication, CI or merge. Once
the preparation problem is resolved, use `clear-blocker --phase review`.
Any independent stage stop recorded while review was parked still requires
clearing its own phase. A review result received while parked is retained for
retrospective use, not admitted as an executable review fact. Then obtain a
fresh `review` via `plan`. The old grant stays inactive, including when the
head or policy changes, and an active overlapping sibling keeps its priority.
Run [official review preparation](../../review-head/SKILL.md) again
under the fresh binding, with the required previous-head RED, same-selection
GREEN, and all selected axes. Clearing the blocker carries no evidence forward.

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
