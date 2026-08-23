# Native reviewer contract

Every `$search-issue` reviewer is an independent, read-only native `task`.
The lead builds the task from this contract, one specialist reference, and one
immutable package route. Reviewers never read legacy `.opencode` assets.

## Task interface

Each task prompt must contain these sections:

1. `TASK`: audit exactly one package using one named specialist role.
2. `DELIVERABLE`: return one JSON object matching
   `../reviewer-contract.schema.json`.
3. `SCOPE`: immutable run ID, invocation ID, package, selected purposes,
   canonical evidence paths, and known duplicate context.
4. `VERIFY`: require exact `path:line` evidence for every finding, validate the
   package and result type, and report every checked path.
5. `STOP WHEN`: the assigned package and specialist questions are exhausted, or
   required evidence is unavailable and the result is `blocked`.

The lead chooses the native task category from `../domain.json` and sends all
independent invocations in waves of at most `max_parallel_tasks`.

When a wave contains two or more invocations, submit them together in one
native `task` batch with `run_in_background: true`. A foreground task or
one-by-one dispatch is not a parallel wave.

## Behavioral invariants

- Stay inside the assigned package and specialist purpose.
- Read source, tests, canonical contracts, package docs, and relevant existing
  issue context only.
- Do not edit files, mutate Git/GitHub state, create issues, publish artifacts,
  update the common ledger, or communicate with another reviewer.
- Return `status: completed` with an empty `records` array when no issue exists.
- Return `status: blocked` only when named required evidence is unavailable.
- Do not duplicate the same package, evidence, problem, and contract impact
  within one result.
- Treat security-sensitive findings and support questions as safety-routing
  inputs, never as public registration recommendations.

## Output envelopes

Finding specialists return `result_type: audit_finding`. Feature research
returns `result_type: rd_brief`. Registration triage uses its own central task
and returns `result_type: registration_triage`.

The lead validates every envelope before moving an invocation from `expected`
to `completed`. Missing, malformed, wrong-package, wrong-reviewer, or
wrong-result responses move it to `failed` and stop the next workflow phase.
Never remove or complete a reviewer todo without both a native task ID and its
terminal typed result.
