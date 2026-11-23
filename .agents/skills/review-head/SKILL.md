---
name: review-head
description: Review one exact local or PR head with the axes selected by preflight and reconciled against the actual diff; return pass, block, or needs-human-check without remote writes.
---

# Review head

This read-only stage belongs to `execute-lane`. A PR is optional. Review
approval is not permission to merge, and reviewers never execute local CI.

## Input and preparation

Require lane/issue identity, accepted preflight, captured base/head, actual
changed paths, implementation report with focused test evidence, and optional
PR identity. The post-review full local CI receipt is not a prerequisite.
When preflight selects CI Node concurrency validation, the lead's completed
original `pnpm test:node` receipt is required before reviewer dispatch on each
implementation, fix-back and conflict-resolution head, after focused checks.
The lead checks actual diff scope and determines the effective axes using the
preflight contract helpers. An out-of-scope change returns to preflight.
Newly implicated axes are added; never trust implementer-reported scope alone.

Before dispatch, the lead materializes the reviewed commit:

```text
git worktree add --detach .worktrees/review-<issue>-<head-prefix> <head-sha>
git -C .worktrees/review-<issue>-<head-prefix> rev-parse HEAD
```

Give each reviewer the absolute checkout path, preflight contract and digest,
captured diff, exact head, and applicable evidence. Reviewers read changed
files from that checkout, never `main`. Inline head observations and captured
check results because a read-only reviewer may have no shell access.

After canonical `plan` selects review, and before spawning any reviewer, run:

```text
node .agents/skills/execute-lane/scripts/workflow-preparation.mjs review <review-input.json>
```

The entry returns a prepared dispatch payload on stdout or a nonzero JSON
`input-preparation` block on stderr. Large outputs additionally retain bounded
transfer files under `artifact_root`; Git and lane facts remain read-only.
It never dispatches children. Do not turn a preparation block into an implementation
fix-back or a product defect. Complete or re-observe the input first.

Supply exactly `version:1`, `stage:"review"`, absolute `root`, `checkout`,
`artifact_root`, `issue`, fresh `issue_sha256`, accepted `contract`, canonical
plan's effective `policy`, `base_ref:"origin/<base_branch>"`, freshly observed
`base_head_sha`, `head_sha`, every `changed_paths`, `diff`, `required_checks`,
`evidence`, the prepared preflight `footprint`, absolute `accepted_contract_path`
pointing to the lead's authoritative current accepted artifact, and
`observation:{path,sha256,bytes}` containing the complete canonical
`plan` output `{issue,decision,obs}` with `decision.action:"review"`. The
preparer compares the artifact and observation to the supplied contract,
head, paths and effective policy, and re-reads acceptance before returning.
Capture the complete
`git diff --binary --full-index --no-renames <current-merge-base> <head>`
as an artifact, not a clipped tool display. `diff` is `{path,sha256,bytes}`
relative to `artifact_root`. The preparer authenticates the actual checkout,
repository, clean head/tree, pinned ancestor and current origin/base, derives
all authored paths independently with `--no-renames -z`, reconciles scope and
policy, and compares the complete diff bytes. `verification_base_sha` remains
the accepted pinned base; `authored_merge_base_sha` can differ after integration.

`required_checks` is the lead's complete accepted focused-command inventory.
Each evidence item is `{command,receipt:{path,sha256,bytes}}`. The authenticated
JSON receipt contains `version:1`, `complete:true`, exact `command`, `head_sha`,
`tree_sha`, `contract_sha256`, `status:"passed"`, `exit_code:0`, `signal:null`,
monotonic `duration_ms`, and `stdout`/`stderr` artifact references with the same
`{path,sha256,bytes}` shape (empty streams have zero bytes). Keep full raw
streams, not only summaries. Missing, truncated, altered, stale or out-of-scope
inputs fail before the review wave. The preparer rechecks observations after
reading evidence.

For a preflight-selected `pnpm test:node`, include the actual execution string
with declared PATH in `required_checks`, `evidence[].command` and the receipt's
`command` exactly. Use the existing receipt fields above, including
`duration_ms` and full streams; add no optional CI-evidence field or schema.
Complete install/build first and preserve the original script file set and
default inter-file concurrency. Split files, `--test-concurrency=1` and
individual passes cannot supply this receipt. Preserve actual Node executable
and version, environment and concurrent-work load observations in retained
output or accompanying incident evidence available to every axis.

The lead completes missing or stale-head receipts before dispatch as
`input-preparation`, `fix_back_eligible:false`. Actual failures, timeouts and
cancellations keep their original logs as incident evidence; unresolved
current-head failures follow the existing local-failure/fix-back boundary.
Neither split success nor another review PASS clears them. Use
`../execute-lane/references/operations.md#timeout-cause-diagnosis-and-corrections`
for matched base/head comparisons and correction history. Pass the same
authenticated `common`/`readable_index` to all axes; no reviewer rerun
substitutes for the lead's selected pre-review evidence.

Review input also requires `implementation:{mode,previous_head_sha,head_sha,
contract_sha256}`. Modes are `implement`, `fix-back`, and `resolve-conflict`.
Bind the current commit and accepted contract; the previous commit must be an
ancestor. For fix-back, take both heads from the actual implementer Result,
not the fixed verification base. A fix-back additionally requires
`fix_back_red:{path,sha256,bytes}`; ordinary implementation and conflict
resolution need no RED receipt. Missing or inconsistent evidence stops before
dispatch as non-fixable `input-preparation`.

The lead prepares a separate clean checkout at `previous_head_sha`, then runs:

```text
node .agents/skills/execute-lane/scripts/workflow-preparation.mjs fix-back-red <input.json>
```

Capture input has exactly `version:1`, `stage:"fix-back-red"`, absolute `root`,
`checkout`, a new `artifact_root`, `issue`, accepted `contract`, `implementation`,
`command`, `argv`, `regression_patch:{path,sha256,bytes}`, and
`failure:{file,line,test}`. The input patch reference is relative to `root`.
Capture validates commit/tree/ancestry and projects only complete regression
test and necessary test-fixture changes actually present at the corrected
head. Product changes are forbidden. The focused runner uses
`argv:[<node executable>,"--test","--test-reporter=tap",<regression paths>]`,
optionally with `--test-name-pattern=...`; use that same command and argv in the
corrected head's passing focused receipt. Prepare tooling regression tests
with this runner; do not substitute a shell command that prints a failure.

Packages regressions may instead use this exact Vitest argv shape:

```text
[<node executable>, "node_modules/vitest/vitest.mjs", "run",
 "--project=packages", <one projected packages test file>,
 "--testNamePattern=<selection>",
 "--reporter=<absolute approved fix-back-vitest-reporter.mjs>",
 "--outputFile=.omo/fix-back-vitest.json", "--maxWorkers=1",
 "--no-file-parallelism"]
```

The executable and installed entrypoint must resolve to the preparer's actual
Node and installed Vitest. Resolve the relative entrypoint from the actual
execution checkout: the previous-head reproduction checkout before capture
spawns, and the corrected-head review checkout during GREEN authentication.
The repository root need not have its own dependency installation; separate
worktrees may link to the preparer's approved installation. A valid root
installation cannot authorize a different checkout entrypoint.
The reporter is the approved sibling of
`workflow-preparation.mjs`, not a caller-selected replacement. No extra runner
options, alternative entrypoints or shell wrappers are accepted. The command
is the argv joined by spaces, using `node` or the absolute executable for its
first token and single-quoting tokens outside `[\w./=:-]+` (embedded single
quotes use shell `'\''` escaping). Retain this exact string and argv for GREEN.

Before assigning fix-back, confirm that runner, the complete projected
test/fixture patch, body assertion identity/first source location, and real
same-command GREEN can be captured. Do not rewrite an unsupported regression
in a different runner to manufacture RED.

Vitest writes `.omo/fix-back-vitest.json` exclusively from its approved
reporter; the output must not already exist. Retain that report as an
authenticated `test_results` artifact in each RED/GREEN receipt. Copy it
beside the receipt and retain its full bytes/hash; printing similar JSON or
claiming exit 0 is insufficient. Remove or archive a previous ignored output
before a separate GREEN capture. Capture rejects a pre-existing output and
never overwrites it.

The collector must reserve a separate pipe at runner fd 3
(`stdio:["ignore","pipe","pipe","pipe"]`). After its exclusive file write,
the approved reporter writes identical complete report bytes to that pipe.
Capture requires both to match and keeps the pipe bytes as `test_results`.
GREEN collectors use the same channel and equality check. Worker stdout or a
worker-created report file cannot prove reporter completion: failure of the
exclusive write leaves the private channel empty and capture rejects it.
Retain complete stdout/stderr separately; they are not this private channel.
The reporter admits only the isolated `packages` forks pool before workers
start. Thread/custom pools are unsupported because worker threads can share
the runner's file descriptors.

The report binds the actual reporter implementation hash and complete runner
outcome, modules, suites, unhandled errors and selected tests. Exactly one
specified test must run once, with matching repository-relative file/name;
other collected tests may only be skipped by selection. The selected test
cannot be skipped/todo, retried, repeated or marked `fails`. RED requires one
genuine assertion with its first valid source frame at the supplied file/line.
Later matching frames cannot hide an earlier helper location. Module/setup,
hook, runtime and unhandled failures are rejected, including hook assertions
reported as test failures. Vitest batches final task state before replaying
events, so hook-event `result().errors` is not proof of where an error arose;
the report preserves terminal hook states and suite errors. Successful hooks
and assertion expected/actual values containing error names remain valid.
The reporter derives the unique `test.callback` invocation location from the
actual installed runner and requires that call site in the unfiltered error
stack. Unknown provenance, around-hook and test-finished hook assertions fail
closed even when their source line matches. The first
unfiltered source file must agree with the source-mapped first frame, so a
later matching frame cannot hide a filtered helper.
GREEN must show that same selected test actually passed with no remaining
runner errors. Malformed/incomplete reports fail closed.

The capture applies the patch to the reproduction index, executes argv, retains
complete stdout/stderr and patch bytes in the new artifact directory, and emits
`receipt.json` only for one named assertion failure at the supplied positive
file/line. GREEN, spawn/import/setup errors, signal termination, and unrelated
failures are rejected. It leaves the reproduction checkout with its test patch
for inspection; cleanup belongs to the lead. This focused lead reproduction is
review preparation only. It changes neither issue-implement's `leadAuthority`
nor reviewer permissions.

The receipt has exactly `version`, `complete`, `producer`, `issue`,
`previous_head_sha`, `head_sha`, `previous_tree_sha`, `contract_sha256`,
`command`, `argv`, `regression_patch`, `exit_code`, `signal`, `duration_ms`,
`stdout`, `stderr`, `failure`. It requires `version:1`, `complete:true`,
`producer:"lead"`, positive integer exit, null signal, finite nonnegative
duration, and hash/byte references for patch and both streams (relative to the
receipt directory). Review preparation authenticates these artifacts, the
complete patch and failure output, commit/tree/ancestry and issue/contract/head,
and matches command/argv to a passing focused receipt. All axes receive the
same `common.fix_back_red:{reference,receipt}`. A child's failed claim or
producer string alone supplies no execution evidence.

Vitest receipts add exactly `test_results:{path,sha256,bytes}` to these RED
keys. Node TAP receipt keys and accepted argv remain unchanged. Preparation
authenticates and rechecks the Vitest artifact along with the existing raw
streams/patch/head/tree/contract bindings and shares it in the same common
evidence/readable index with every active reviewer axis.

`common.readable_index` is decoder-free machine metadata derived from those
authenticated receipts and raw artifacts, with exact head/tree, distinct
`contract_sha256` and `policy_sha256`, actual command outcomes/durations and
source references. Actual Node reporter summaries or a receipt's `test_results`
artifact supply test metadata; missing counts remain `null`. A receipt's
`packed_receipt` supplies the actual packed command inventory, authenticated
against each command receipt, separate raw streams, combined log and any browser
report. Retain packed artifacts beside their original producer receipt when
archiving; producer absolute paths are relocated within that artifact subtree.
An optional input `readable_index:{path,sha256,bytes}` authenticates a previously
retained index and must equal the freshly derived index. Missing, truncated,
altered or rebound index/source evidence is an input-preparation failure.
Every selected axis receives the identical returned index; no decoder, shell
execution or invented summary counts are required to inspect it.

Give each selected child the returned `reviewers[i].input` unchanged: every
axis receives the same `common` contract/policy, source footprint, authored
diff, checkout and focused evidence. Do not substitute an implementer-reported
path list, the contract digest for the policy digest, or another checkout.

### Bounded complete review transfer

The existing `review <review-input.json>` invocation needs no new arguments.
Small results retain exactly `status:"prepared",kind:"review-input",common,
reviewers` and require no decoder. If its actual pretty-printed UTF-8 output
would exceed 49,999 bytes or 1,500 lines, the CLI instead returns
`{status:"prepared",kind:"review-transfer",artifact_root,transfer,reviewers}`.
Each reviewer entry retains its registered `reviewer`/`dispatch` and the
identical `transfer`. Pass that object and the absolute artifact root unchanged
to every selected axis, together with the captured exact-head identity.
API callers may use `prepareReviewTransfer(input)` for the same selection;
`prepareReviewInput(input)` keeps its original in-memory result.

`transfer` has exactly `version:1`, `manifest:{path,bytes,sha256}`,
`prepared:{bytes,sha256}`, and `binding:{issue,head_sha,tree_sha,
contract_sha256,policy_sha256,axes}`. Preserve the lead-provided transfer as the
authentication anchor; never regenerate its digests from suspect files.
Contract and effective policy identities stay distinct. The manifest is itself
authenticated by its external byte length and SHA-256. It contains `version`,
the identical `binding` and `prepared`, `limits`, `total_bytes`, and the complete
ordered `units` inventory. Each entry has `index`, UTF-8 assembly `offset`,
`content_bytes`, `lines`, and `reference:{path,bytes,sha256}`. Each referenced
compact JSON unit has exactly `{version:1,index,offset,text}`. Concatenate
decoded `text` strings in inventory order to reconstruct the complete compact
JSON serialization of the original prepared result, including every repeated
reviewer input. No summary, omitted command, or changed meaning is permitted.

Every manifest, unit, dispatch envelope and reader output is at most 49,999
actual UTF-8 bytes and 1,500 lines, including JSON escaping and wrappers.
Stored units and manifests use compact JSON with one line. A fragment contains
at most 16,000 UTF-8 content bytes and never splits a Unicode code point.
The complete prepared serialization is at most 2,097,152 bytes, with at most
132 units; manifest plus all unit file bytes must not exceed 8,388,608.
These version 1 limits are fixed, not caller overrides. Exceeding any limit
blocks the whole transfer; a partial directory is never successful input.
Files live in `artifact_root/review-transfer-<prepared-sha256>/`.

Before consuming any unit or judging the implementation, authenticate and
validate the entire manifest and every unit, then the assembled byte length,
SHA-256 and reconstructed binding/common inputs. `readReviewTransfer(root,
transfer)` performs this check and returns the original prepared object for
programmatic consumers. For bounded tool reads, supply exactly
`{version:1,stage:"review-read",artifact_root,transfer,index}` to:

```text
node .agents/skills/execute-lane/scripts/workflow-preparation.mjs review-read <reader-input.json>
```

`index:null` returns the authenticated manifest; each integer index returns its
authenticated unit. Every call validates the complete transfer before emitting
any stdout. Read every index in order without clipping, decode each JSON `text`,
and consume the complete reconstructed common/readable_index; a manifest alone
is not review evidence. All three axes consume the same bytes. Retain full
underlying diff, receipts, packed inventory and raw streams beside the transfer.

Missing, unreadable, truncated, altered, duplicated, omitted, reordered,
misbound, wrong-length or oversized files/references produce nonzero structured
stderr with `kind:"input-preparation",fix_back_eligible:false` and no success
stdout. Stop before any verdict and return this input gap to the lead; never
turn it into product BLOCK, implementation fix-back or implicit PASS.
Transfer authentication preserves the prepared snapshot; it replaces none of
the footprint/caller searches, authoritative accepted contract, canonical plan,
base/head/tree, complete authored diff, policy/axes, implementation mode,
fix-back RED, required checks, raw/packed evidence admission or final freshness
recheck described above. The producer rechecks head/base/clean status and the
accepted contract after retaining and reading the transfer. The lead still
revalidates head and preflight before accepting the review aggregate.

## Review wave

Read only the references for selected axes:

- `references/reviewers/contract.md`
- `references/reviewers/code.md`
- `references/reviewers/verification.md`

Dispatch all selected axes in one background task batch using each returned
`reviewers[i].dispatch.subagent_type`:
`fluo-contract-reviewer`, `fluo-code-reviewer`, or
`fluo-verification-reviewer`, with `run_in_background: true`. Each registered
agent first reads its matching role reference from the supplied exact-head
checkout. Missing registration or runtime unavailability is typed
`input-preparation` with `fix_back_eligible: false`, recorded through
`execute-lane`'s dispatch admission contract; never use a category substitute
or turn this into implementation fix-back. Each child stays
read-only and reports against the same head and preflight contract. Missing
PR checks before a PR exists are not missing local evidence: the verification
axis judges regression coverage and the implementer's focused test results.
Full local CI runs only for explicitly requested reproduction or diagnosis,
after the selected reviews pass. All approved changes, including
CI/configuration, manifests and lockfiles, proceed directly to publication
after focused checks, any preflight-selected original `pnpm test:node`, and
reviews; full remote CI follows publication. The selected pre-review command
does not claim completion of canonical `pnpm verify:local`.

Use `scripts/contracts.mjs` to aggregate exactly one result per selected axis.
Before aggregation or rejecting any envelope, retain each raw reviewer response
with `lane-v4-cli.mjs retro-record --kind review` (see `../retrospective-lane/SKILL.md`).
Record lead adjudications/reproductions as separate incident observations.
This preserves false, stale, missing-input and confirmed blockers instead of
overwriting them with the final PASS; it never substitutes for this review gate.
Reject missing, duplicate, malformed, unexpected, or stale evidence. Never
invent a skipped reviewer's PASS. Concrete remediation produces canonical
blockers; unavailable intent or authority produces `needs-human-check`.

Revalidate the head and preflight before accepting the aggregate. Any new
implementation or conflict-resolution head requires fresh review of every
required axis. The only exception is Git-authenticated retention below;
raw old-head envelopes never combine with new-head results.

### Explanatory-document retention

The CLI observes previous/current merge-bases against immutable origin/base,
both authored path sets, and their actual head-to-head delta with
`--no-renames -z`. The delta intersected with the union of authored paths must
be nonempty explanatory Markdown. A closed allowlist admits root/package
README pairs, `docs/guides`, `docs/getting-started`, `docs/architecture` Markdown,
and numbered Book chapters. Instructions, governance, tests/fixtures,
generated or machine-read Markdown, MDX and unknown roles are excluded.
Every non-explanatory authored path must retain identical raw blob SHA-256
and Git mode at both heads, including paths previously authored then removed.
Unavailable or uncertain Git evidence requires full review.

Only a canonical previous PASS under the identical contract and full effective
policy permits retaining active code/verification axes. Contract is always
fresh; no inactive axis gains a PASS. Preparation independently re-observes Git
and matches the canonical fresh dispatch. Every fresh reviewer still receives
the complete diff, source footprint and new-head focused receipts. Full policy,
its digest and the approved axis floor remain unchanged.

The current-head fact's optional `retention` has exactly:
`version:1`, `previous_head_sha`, `new_head_sha`, `contract_sha256`,
`policy_sha256`, `previous_merge_base_sha`, `new_merge_base_sha`,
`previous_review`, `previous_accepted_at`, `changed_files`, `compared_files`.
`previous_review` preserves the complete canonical PASS and original identities.
`changed_files` is the sorted unique authored delta. Each sorted unique
comparison is exactly `{path, axes, previous_sha256, new_sha256,
previous_mode, new_mode}`, with sorted unique retained code/verification axes.
Git observes absence as null; absent, changed or unreadable non-prose blobs/modes
cannot retain PASS. Every nested hop and original envelope head is validated.
The CLI reauthenticates complete coverage and bytes both at admission and
observation. Changed contract/policy, missing previous PASS or tampering removes
the exception. Local-checks, omission audits, generated-integration receipts
and full current-head GitHub CI retain their independent exact-head gates.

## Machine interface

Take the current `obs.preflightPolicy` from lane `plan`. Its `sha256` binds
both the fixed contract and effective axes. Do not substitute the artifact's
own `sha256` (the implementation binding) for this policy digest.

Each new reviewer returns exactly `reviewer`, `agent`, `reviewed_head_sha`,
`preflight_sha256`, `verdict_signal`, `blockers`, `evidence`, and `observations`;
`preflight_sha256` equals
the effective policy digest.
`agent` must equal the registered target for that axis. New `record` review
successes carry this complete aggregate input with `ok:true`. Stored legacy
facts with the old five keys or six keys including `agent` retain full
head/policy/verdict/blocker validation and their original bytes and acceptance
bindings, including every retention hop; new inputs cannot use that path.
Stored envelopes with modern evidence must include both new fields and meet
all new requirements. Partial shapes and unknown keys are rejected.
`evidence` contains exact `{acceptance,locations}` entries: a non-empty
criterion identifier and a non-empty array of repository-relative `file:line`
locations. PASS requires at least one entry. Every verdict includes
`observations`, an array of non-empty strings (possibly empty), which never
changes the aggregate verdict or canonical blockers.
Assemble:

```text
{ head_sha, preflight_sha256, active_axes, reviews }
```

`aggregateReviewerGate(input, policy, retention?)` validates this payload.
`buildReviewFact(input, headSha, policy, retention?)` derives the persisted verdict; the
lead must not invent aggregate fields independently of the envelopes.
Only the CLI supplies the optional final argument from stored facts and Git.
The external four-key payload stays unchanged: `active_axes` is the full
effective policy and `reviews` contains exactly the fresh required envelopes.
Caller-supplied retention is rejected. Omitting the final argument preserves
the original exact-head behavior. `validateReviewFact(value, headSha, policy)`
accepts optional stored retention, validating fresh and retained coverage
without rewriting original reviewer heads or legacy facts.
Record the input through the CLI, which re-observes the policy and head:

```text
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs set-fact --root . --lane <lane.json> --issue <n> --kind review --head <sha> --value '<input-json>'
```

## Output and stop

Return `pass | block | needs-human-check`, the head and preflight binding,
effective axes, individual envelopes, and canonical blockers. Record the
review fact through `execute-lane`; it decides fix-back or publication.
An absent full local CI receipt or waiver is not a gate; applicable current-head
local failures still require fix-back, and omission is never a local CI PASS.
Do not push, create/update a PR, merge, or clean up. Review checkout cleanup
belongs to the lead's lane cleanup, not reviewer authority.
