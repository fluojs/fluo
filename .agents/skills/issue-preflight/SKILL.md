---
name: issue-preflight
description: Fix one lane issue's implementation contract and selective review policy before implementation; reassess when issue, base, or approved scope changes.
---

# Issue preflight

This mandatory stage belongs to `execute-lane`. It is not a second planning
workflow and never implements, creates a PR, or chooses the next lane action.
The child reads sources; the lead validates and records the accepted result.

Dispatch with `subagent_type: "fluo-issue-preflight"` and
`run_in_background: true`, using the engine/preparer's `dispatch`. The registered
agent first reads `references/preflight.md` in the supplied repository/checkout.
It stays read-only. The lead's successful `record` wrapper includes
`agent: "fluo-issue-preflight"`; keep that identity outside the accepted artifact
and its digest. An unregistered or unavailable target is a typed
`input-preparation` block with `fix_back_eligible: false`, recorded using the
`execute-lane` dispatch admission contract. Never replace it with a category
worker or send it to implementation fix-back.

## Input

Require lane and issue identity, freshly captured issue content, base identity,
existing implementation identity if present, and the relevant contract sources.
Read `CONTRIBUTING.md`, `docs/contracts/behavioral-contract-policy.md`, affected
package README pairs, implementation seams, and existing regression tests.
Inspect current local changes on a resumed issue before defining its scope.

Before the preflight child starts, prepare its source-footprint sidecar with
`../execute-lane/scripts/workflow-preparation.mjs preflight <input.json>`.
The exact input is `{version:1, stage:"preflight", root:<absolute checkout>,
footprint:<source footprint>}`. Attach the returned `footprint` to the actual
child input and retain it for finalization and review preparation. This command
does not mutate a lane ledger.

The footprint binds `version:1`, `issue`, fresh `issue_sha256`, pinned
`base_sha`, `categories`, and `caller_searches`. Every category (`direct_callers`,
`reflective_integration`, `governance`, `book`, `en_ko_owners`, `context`,
`generated_consumers`, `existing_tests`) contains exactly
`{affected:boolean, reason:string, sources:[{path,sha256}], searches:string[]}`.
Sources are complete files from the pinned commit; the executable preparation
authenticates their bytes with Git. Record actual queries and inspected paths,
including Reflect.get/property consumers, source guards, Book excerpts,
EN/KO owners and CONTEXT, generated sourceFingerprint/consumers, and existing
tests. An affected category requires a source; an unaffected category still
requires an investigation and a concrete selection rationale. No category
implicitly mandates editing all candidates. The child consumes this footprint
when choosing scope, companion files and checks, and reports any missing
investigation as an input-preparation block before fixing the contract.

New preflight preparation requires a nonempty `caller_searches` array of
`{symbol, command, matches:[{path,line,text}]}` with unique nonempty symbols.
Use `git grep -n -w -F -e <symbol> <base_sha> --` against the entire pinned
repository, including `tooling/ci` and `tooling/governance/fixtures`. Simple
symbols are unquoted; otherwise use POSIX single quotes (escape an embedded
quote as `'\''`). Matches contain repository paths, positive line numbers and
the complete line text in Git order. The preparer executes fixed argv, never
the supplied command string, and compares all matches. Exit 1 means no matches;
other Git failures block preparation. Incomplete or altered searches cannot
authorize dispatch. Previously accepted footprints without this optional field
remain valid for review with their original digest; do not rewrite them.

## Fix the contract

Produce an explicit scope, non-goals, contract source references, acceptance
criteria, verification criteria, and expected changed paths. Criteria must
describe observable behavior rather than prescribe implementation internals.
Resolve conflicting source claims before accepting a contract. A missing
product decision is not permission to narrow the documented behavior.

Choose active review axes and record a concrete reason for every omitted axis:

| Change role | Required axes |
| --- | --- |
| Explanatory documentation only | contract |
| Tests and fixtures only | code, verification |
| Runtime/API, mixed, or unknown changes | contract, code, verification |
| Workflow instructions, skills, enforcement, or governance | contract, code, verification |

Classify the role, not just the extension. `SKILL.md`, agent instructions,
machine-consumed Markdown, and executable examples are not automatically
explanatory docs. On ambiguity, retain the full set. Extra axes may be selected
when the contract needs them; omission requires an empty review scope.

### CI Node concurrency selection

Record in both acceptance and validation whether the change affects the CI
`pnpm test:node` execution path or its concurrent resource use, with inspected
paths and a cost rationale. Inspect `package.json`'s actual `test:node` file set,
the tests' implementation, fixtures and shared helpers. Include changes to
long-running work, subprocesses, watches, locks, external observations or
resource contention on that path. Uncertainty means include the command;
file extensions alone cannot justify exclusion. Procedure-only documents with
no effect on that execution path may be excluded with investigated evidence.

When applicable, require the lead to run the original `pnpm test:node` after
focused checks and before reviewer dispatch on every implementation, fix-back
and conflict-resolution head. Preserve its file set and default inter-file
concurrency; split files, `--test-concurrency=1` or individual passes cannot
replace this result. Declare install/build prerequisites, the exact runtime and
PATH, environment and concurrent-work observations, and the existing
`required_checks`/`evidence` receipt delivery described in
`../execute-lane/references/operations.md#ci-node-concurrency-before-review`.
Account for the suite's execution cost without inventing a duration threshold
or treating it as full canonical `pnpm verify:local`.

For example, a shared helper changing watch/subprocess lifetimes is included
even if its own focused tests pass. In #4141, the four internal workflow
documents change lead procedures only: no Node test, implementation, fixture,
helper, execution path or resource use changes. The full concurrent suite adds
cost without exercising a changed executable seam, so it is excluded for this
issue. Existing preflight/review-preparation regressions on primary Node
24.21.0 and floor Node 24.11.0 plus three-axis document review are selected;
no new deterministic tests are added. If implementation expands into execution
code, return to preflight and include primary Node 24.21.0 `pnpm test:node`
and Node 24.11.0 affected tests rather than retaining this exclusion.

## Acceptance and freshness

Use `scripts/contracts.mjs` and the `execute-lane` CLI to validate and persist
the contract. Bind it to the lane issue and its source/base evidence, not each
future implementation head. Ordinary implementation commits retain the
contract; advancing `origin/<base_branch>` alone does too. The accepted
`base_sha` is an immutable anchor, not a comparison with the latest branch
tip. It must exist as a commit and remain an ancestor of the base branch and
the issue head (if present). Changed issue intent, invalid or changed
approved base, or out-of-scope paths require preflight again. Registering
the identical digest preserves review and local-check facts and timestamps;
a different digest invalidates them.

Before review, the lead independently captures the actual issue diff from
the current merge base with `origin/<base_branch>` to the issue head.
This excludes upstream changes incorporated during conflict resolution;
it does not replace the pinned base used for local verification.
It reconciles every changed path against approved scope and the review policy.
Newly implicated axes are added; a child cannot shrink the policy. Scope or
contract changes return to preflight, not an implementer-authored exception.
A changed contract invalidates evidence bound to its earlier digest.

The explanatory-document retention exception does not change this classifier,
accepted axes, policy floor or digest. `isRetentionProsePath` is a narrower
closed classification used only with CLI Git observation: root/package README
pairs, selected explanatory docs directories and numbered Book chapters.
Generated, executable, instruction, governance and machine-read Markdown are
excluded. Uncertainty requires full review. The CLI must authenticate both
authored path sets, their head delta and unchanged non-prose blobs/modes before
retaining an active code/verification PASS; contract always receives fresh
review. See `review-head` for proof shape, nested validation and invalidation.

## Machine interface

Read `scripts/contracts.mjs`. The read-only child returns a digest-free
`contract_input`; the lead runs `finalize-preflight` to produce a validated
version 1 artifact with these fields:

```text
version, issue, issue_sha256, base_sha, scope, non_scope,
acceptance, validation, predicted_files, active_axes, omitted_axes, sha256,
validation_requirements (optional for legacy artifacts)
```

Use `issueDigest({ title, body })` on the fresh issue observation.
`scope` and `non_scope` are repository-relative file paths or directory
prefixes ending in `/`, not globs. `predicted_files` names concrete files
inside scope. `acceptance` and `validation` are nonempty string arrays;
include governing source references and behavioral non-goals in the criteria.
`omitted_axes` maps each inactive axis to its rationale. The constructor
computes the digest; never invent one or add unrecognized keys.

New finalizations require `validation_requirements`, exactly one entry for
each unchanged `validation` string. A local entry is
`{validation,kind:"local",command,prerequisites:{tools:[{name,path_dirs}],
artifacts:[{path,kind}]}}`. `command` must be directly runnable, including any
required PATH prefix. Declare absolute tool search directories, required
dependency directories and concrete built files, with artifact kinds `file`
or `directory` and safe worktree-relative paths. State which install/build
commands must run first; empty prerequisite lists explicitly mean none.
Without PATH assignments, preparation searches declared `path_dirs` then
inherited PATH for executable regular files. Leading `PATH=... cmd` and
`export PATH=...; cmd` instead use only that command's PATH, in order;
`path_dirs` never adds directories to it. Literal single/double quotes work;
unquoted or double-quoted `$PATH`/`${PATH}` expands inherited PATH at its
position, while single quotes keep it literal. Relative/empty entries resolve
from the assigned worktree.
Good: `PATH=/opt/node/bin:/opt/pnpm/bin:$PATH pnpm test:node` or
`export PATH="/opt/node/bin:/opt/pnpm/bin:$PATH"; pnpm test:node`.
Wrong: `PATH=/opt/node/bin pnpm test:node` with pnpm only in inherited PATH or
declared `/opt/pnpm/bin`. Preparation only parses strings and inspects files,
never executing commands, tools, shells or substitutions. Unsupported
command/backtick substitutions (`PATH=$(find-tools) pnpm test`), other
variables/parameter operations, unquoted tilde/globs, escapes, malformed quotes
and wrapped/later/multiple PATH assignments block with `kind:"input-preparation"`,
`fix_back_eligible:false`; inherited PATH cannot justify success.
A CI-only entry is `{validation,kind:"ci-only",check,reason}` and cannot claim
local success. Legacy artifacts keep `validation:string[]`, unchanged digests
and policy when requirements are absent.

The lead supplies `{version:1,stage:"finalize-preflight",root,
footprint:<authenticated raw footprint>,contract_input}` to:

```text
node .agents/skills/execute-lane/scripts/workflow-preparation.mjs finalize-preflight <input.json>
```

`contract_input` contains no `sha256`, `dispatch` or `agent`. Finalization
authenticates the footprint, binds issue/issue digest/base and validates complete
requirements through `createPreflight` and `validatePreflight`. Success is
`{status:"prepared",kind:"preflight-contract",contract}`. It writes no file,
fact or ledger; the lead separately records the returned contract.

Record the artifact from the repository root:

```text
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs set-fact --root . --lane <lane.json> --issue <n> --kind preflight --value '<artifact-json>'
```

Then run `plan`. Its `obs.preflightPolicy` is the effective policy derived
from the accepted artifact and actual diff. The artifact's `sha256` binds
implementation; the effective policy's `sha256` binds review.

## Output and stop

Return `contract_input` with source bindings, active review axes, omitted-axis
reasons and investigation rationale. Do not compute a digest or return an
accepted artifact. The lead finalizes it, records the accepted preflight with
agent identity outside its digest, and runs lane `plan` again. The child stops
after returning its input and rationale.
