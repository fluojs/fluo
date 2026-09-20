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
contract; changed issue intent, base evidence, or out-of-scope paths require
preflight again.

Before review, the lead independently captures the actual base-to-head diff.
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
