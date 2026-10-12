# Local implementation evidence

Issue 3914 private `paired-node-180-v1` increment; no performance collection.
Bound preflight: `f1bad8d11dc53e87efaccba542b087938211748f406dd0ed02528ec519d18ea5`.
Starting head: `526ac5b3514ff0c18e48c76bfa379c00b3a379dc`.

Raw verification logs are retained beside this file. No Changeset is required:
only the private comparison harness and its tests change, with no published
package contents, public API, runtime defaults, or release metadata affected.

## Closed profiles

The existing `paired-node.mts` entrypoint accepts two explicit plan schemas:
`paired-node-v1` retains 30-second warmup and 60-second measurement;
`paired-node-180-v1` retains the same warmup and measures for 180 seconds.
Neither schema accepts arbitrary CLI timing overrides. Node 24.21.0,
stage-minimal, equivalent configuration, concurrency 64, the fixed 12-run order,
minimum request count, CV limits, and every pair/median regression budget are
unchanged. A candidate requires a calibration from its own schema, platform,
source and condition. Diagnostic instrumentation remains forbidden.

The collector deadline is 180 seconds for the original profile and 300 seconds
for the extended profile, preserving the 90-second non-load allowance and
separate bounded teardown. Finite fixtures retain their individual 20-second
deadline; they verify real HTTP and declared phase options with finite request
amounts, not 180-second performance traffic.

## Verification and retained failures

`red.log` records the assertion-level failure before implementation:
the extended schema returned `FAIL_EVIDENCE` instead of the expected scoped
verdict. `focused-final.log` passes all 114 tests in 91.003 seconds.
`full-harness.log` passes 396 of 397 tests in 92.170 seconds, with zero failures
and the existing Linux-only skip on macOS. The owning terminal reported exit 0.
These durations describe individual test runs, not canonical local CI.

The earlier `focused.log` retains two failed finite child invocations. The
implementer reported editing tests while this run was active; the lead
preserved that incident and checked the fixed-source run instead of removing
or weakening the tests. Typecheck, changed-file diagnostics, lint and diff
checks accompany the tests. No independent review, remote CI, performance
calibration or candidate acceptance is claimed by this local increment.
