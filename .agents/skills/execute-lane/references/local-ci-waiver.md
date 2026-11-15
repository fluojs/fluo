# local-ci-waiver

Run commands from the repository root; resolve reference paths relative to this file.

### Optional full-local-CI omission audit

When the operator has explicitly instructed the lane not to run full local CI,
the lead may retain that existing instruction through `local-ci-waiver` after
every selected review passes at the current head. Do not infer authority from
preflight prose, automatically create a waiver, or run a prohibited verifier to
produce a receipt. This is optional audit evidence, not a publication gate:
no change requires a waiver to omit full local CI. The fact never proves execution;
focused checks, preflight, scope, dependencies, Changesets, review, remote
head equality, full remote CI, mergeability and merge authority still apply.
An applicable local failure, including failed receipt revalidation, still
requires fix-back. Registration neither clears failures nor resets attempts or
blockers.

Use fresh `plan` observations and `localCheckBinding(obs.review,
obs.reviewAcceptedAt)` from `../scripts/lane-v4.mjs`. Supply exactly:

```text
{
  laneId, issue, status: "waived", scope: "full-local-ci",
  preflightSha256, reviewSha256, reviewAcceptedAt,
  authority: "explicit-operator-instruction",
  evidence: {
    kind: "accepted-preflight",
    contractSha256,
    criteria: ["A12", "V12", "SE-V05"]
  }
}
```

The three binding fields come from `localCheckBinding`: `preflightSha256` is
the effective review policy digest, not the accepted contract digest.
`evidence.contractSha256` is `obs.preflight.sha256`, the canonical accepted
artifact digest. `criteria` contains nonempty, distinct criterion references
for the already accepted instruction; the identifiers above illustrate such
references, not automatic authorization or a prose-matching rule.

```text
node .agents/skills/execute-lane/scripts/lane-v4-cli.mjs set-fact --root . --lane <lane.json> --issue <n> --kind local-ci-waiver --head <current-head> --value '<waiver-json>'
```

The CLI re-observes head, contract, effective policy and selected review PASS,
then rejects stale caller bindings instead of rebinding them. It stores
`{ head, accepted_at, value }` in `facts["local-ci-waiver"]` and exposes that
wrapper as `obs.localCiWaiver`, separately from `obs.localChecks`.
`accepted_at` records the assertion time only. Receipt fields, `status:
"passed"`, `valid: true`, execution timestamps and unknown keys are rejected.
A waived gate must be reported as waived, never as passed or executed.

Head, lane/issue, contract, policy, review content or review acceptance changes
invalidate the waiver. Replacing preflight or review clears it alongside local
checks; identical accepted preflight re-registration preserves those facts.
An unrelated main advance preserves the pinned valid ancestor and binding.
A new head needs all selected reviews; retaining the optional audit fact on that
head requires explicit registration under the still-applicable operator
instruction. The audit binding is never carried forward automatically.
Remote rollup handling is unchanged: this audit fact does not
prove a required check count or replace the lead's complete remote-CI evidence.
