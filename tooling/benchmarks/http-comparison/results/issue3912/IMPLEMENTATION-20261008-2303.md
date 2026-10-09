# #3912 local candidate evidence

- Accepted base: `1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18`.
- Assigned branch/worktree: `issue-3912`, `.worktrees/issue-3912`.
- Input and observed clean identity passed the canonical issue-implement validators.
- Candidate source: `packages/platform-express/src/adapter.ts`, `createFrameworkResponse`.
- Existing evidence: `../profiling/bottleneck-map.json`, finding `express-response-wrapper`;
  `../profiling/REPORT.md` links primary and confirmation raw captures.
  Recorded self shares are 6.0098% and 5.1098%, not absolute CPU time or an optimization delta.
- Construction currently normalizes every native header and constructs a stream facade,
  including requests that never read either capability. The candidate retains the native
  construction-time header snapshot, deferring normalized-record and stream-facade creation.
- Regression observes native snapshot value reads through a transparent Proxy at a real
  Express listener. It covers native route and duplicate-slash fallback, default Factory
  security headers and user middleware, numeric/array/header snapshots, direct mutation,
  repeated reads and native-before-Fluo ordered cookies. No clock or source-string assertion.
- Shared Fastify request shell stays unchanged: sampling a shell alone does not justify
  replacing its lazy metadata/cancellation contracts. Node `writev` is unconfirmed host cost.
- No performance, load or profile runs belong to this candidate. Serialized exact-head
  BEFORE/AFTER, native/Nest matrix, other-platform nonregression and independent review
  remain lead-owned. This local artifact does not establish full issue acceptance.
- Initial provisioning: assigned worktree has no `node_modules`; frozen install is required.

## Local correctness checkpoint

- `pnpm install --frozen-lockfile`: exit 0, 5.2s; lockfile unchanged.
- RED: `pnpm exec vitest run --project packages packages/platform-express/src/adapter.test.ts -t 'response snapshot:' --maxWorkers=1`
  exited 1 with four actual-listener assertion failures: `expected 7 to be +0`.
  See `red-20261008-2303.log` (24.68s including initial emitted-artifact setup).
- First GREEN attempt: the four cost/snapshot regressions reached the final security
  assertion but failed a newly written test expectation: `expected 'SAMEORIGIN' to be 'DENY'`.
  `security-headers.ts` and existing runtime listener coverage confirm `SAMEORIGIN`
  is the default. Only the new incorrect expectation was corrected.
  The failed attempt is retained in `green-20261008-2303.log`.
- Corrected GREEN: `pnpm exec vitest run --project packages packages/platform-express/src/adapter.test.ts -t 'response snapshot:|response facade:' --maxWorkers=1`
  exited 0, five tests passed (79 unrelated tests excluded by the focused selector).
  See `green-corrected-20261008-2303.log`. Stream identity, explicit replacement and
  drain listener cleanup are included; previous native snapshot reads are now deferred.
- Language-server diagnostics for both edited TypeScript files reported no errors.
  This is not an accepted affected-package typecheck receipt.
- `git diff --check` passed. HEAD remains the exact accepted base.

## Blocking unrelated check

`pnpm exec biome check packages/platform-express/src/adapter.ts packages/platform-express/src/adapter.test.ts`
exited 1:

```text
packages/platform-express/src/adapter.test.ts:1:1 assist/source/organizeImports FIXABLE
The imports and exports are not sorted.
Checked 2 files in 30ms. No fixes applied.
Found 1 error.
```

See `governance-20261008-2303.log`. The flagged import block is unchanged by this
candidate. Accepted-base reproduction is captured separately in
`base-biome-20261008-2303.log`.

The accepted-base check used
`git show 1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18:packages/platform-express/src/adapter.test.ts | pnpm exec biome check --stdin-file-path packages/platform-express/src/adapter.test.ts`
and exited 1. Biome's stdin mode emits the original source plus
`The contents aren't fixed. Use the --write flag to fix them.`, not the path-mode
`organizeImports` diagnostic. The retained original source begins with the same
unchanged, out-of-order import block flagged by the candidate path-mode check.

The task explicitly requires stopping on an unrelated failure. No import cleanup,
test weakening, gate bypass, commit or remote mutation was performed. The command
chain stopped at Biome: TSDoc, platform governance, release readiness, docs parity
and tooling governance tests did not run. Accepted three-platform closure build,
affected typechecks, complete adapter/Node suite and examples also did not run.
The source candidate, five regression tests, EN/KO companions and Express patch
Changeset remain uncommitted for the lead.

No completed canonical Result is returned: there is no new commit or fully passed
focused-check receipt, and the canonical schema has no partial-success variant.

## Lead takeover checkpoint

The preceding section preserves the worker's original incomplete return. The lead
subsequently sorted the touched test file's imports without changing assertions.
Both changed TypeScript files have clean LSP diagnostics.

- `lead-adapter-validation-20261008.log`: changed-file Biome, the three Node
  platform dependency closure build, 19 test files / 306 tests, and all three
  affected package typechecks passed; monitor exit 0.
- `lead-governance-20261008.log`: fresh workspace build, 16 example test files /
  102 tests, EN/KO documentation parity, public-export TSDoc, platform governance,
  475 governance tests and stable Changeset verification passed; monitor exit 0.
- Preflight was corrected to keep ordinary-change local checks focused and
  preserve full repository verification in the mandatory final-head GitHub CI.
  This does not represent an unrun local release-readiness command as passed.

These are correctness and release-metadata results, not measured speedups.
Fastify/Node cost attribution, serialized exact-source BEFORE/AFTER measurements,
other-platform nonregression, independent exact-head review and remote CI remain
open issue-acceptance work.

## Whole-request diagnostic rejected the combined candidate

The clean BEFORE at `1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18` and clean
candidate `a39c0456f65ae71408f72820a5eb7514de09505f` used identical benchmark
source for 18 completed equivalent/minimal/concurrency-64 samples, with native,
Fluo and Nest controls and no invalid attempts or traffic mismatches.
Fluo throughput median fell 5.04%, CPU/request rose 4.51%, p95 rose 4.79% and
p99 rose 2.65%; before/after ranges for those metrics did not overlap. Native
and Nest controls were stable or slightly faster. Raw files and hashes remain
under the root `.omo/verification/3912-express-minimal-*` paths.

This candidate is rejected, not marked within a retrospectively chosen budget.
Header normalization has been restored to its original eager snapshot path;
only stream-facade deferral remains as the next candidate. The newly added
snapshot tests now assert that restored eager behavior while retaining their
native mutation, ordered-cookie, identity and real-listener assertions.
`stream-only-green-20261008.log` records 19 files / 306 passing adapter tests,
Express typecheck, Biome and documentation parity with exit 0. Whole-request
performance of the stream-only candidate is still unverified.
