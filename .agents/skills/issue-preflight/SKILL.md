---
name: issue-preflight
description: Fix one lane issue's implementation contract and selective review policy before implementation; reassess when issue, base, or approved scope changes.
---

# Issue preflight

This mandatory stage belongs to `execute-lane`. It is not a second planning
workflow and never implements, creates a PR, or chooses the next lane action.
The child reads sources; the lead validates and records the accepted result.

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
child input and retain it for review preparation; do not add fields to the
accepted version 1 preflight artifact or mutate a lane ledger here.

The footprint binds `version:1`, `issue`, fresh `issue_sha256`, pinned
`base_sha`, and `categories`. Every category (`direct_callers`,
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

## Machine interface

Read `scripts/contracts.mjs`. `createPreflight(input)` returns a validated
version 1 artifact with these fields:

```text
version, issue, issue_sha256, base_sha, scope, non_scope,
acceptance, validation, predicted_files, active_axes, omitted_axes, sha256
```

Use `issueDigest({ title, body })` on the fresh issue observation.
`scope` and `non_scope` are repository-relative file paths or directory
prefixes ending in `/`, not globs. `predicted_files` names concrete files
inside scope. `acceptance` and `validation` are nonempty string arrays;
include governing source references and behavioral non-goals in the criteria.
`omitted_axes` maps each inactive axis to its rationale. The constructor
computes the digest; never invent one or add unrecognized keys.

Record the artifact from the repository root:

```text
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs set-fact --root . --lane <lane.json> --issue <n> --kind preflight --value '<artifact-json>'
```

Then run `plan`. Its `obs.preflightPolicy` is the effective policy derived
from the accepted artifact and actual diff. The artifact's `sha256` binds
implementation; the effective policy's `sha256` binds review.

## Output and stop

Return the validated implementation contract, source bindings, active review
axes, and omitted-axis reasons. The lead records the accepted preflight and
runs lane `plan` again. Stop after the contract is recorded; do not dispatch
implementation or operate a task graph.
