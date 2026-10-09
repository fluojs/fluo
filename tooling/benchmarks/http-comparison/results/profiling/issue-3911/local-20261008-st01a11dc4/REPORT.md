# Issue 3911 local implementation evidence

## Identity and scope

- Worktree: `.worktrees/issue-3911`; branch: `issue-3911`.
- Preserved BEFORE base: `1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18`.
- Initial worker preflight: `23dbfbaf00e96cb549c3643a95e5d2d69c6df605a31616274748fa55a6dc7c43`.
- Lead verification-location correction: `82de87397299073697a7c3b9e88169638c3717aa164218e1b3be086db3d63e43`; runtime scope and performance acceptance are unchanged.
- Host: macOS arm64; Node `24.20.0`, pnpm `10.4.1`, Bun `1.4.2`, Deno `2.9.7`.
- Commands below run from the assigned worktree unless `--dir` specifies the isolated correctness harness.
- Only `packages/runtime/src/web.ts` changes production behavior. HTTP dispatcher, request-ID capabilities, adapters, DI and React sources remain unchanged.

## Selected cost and correction

The preserved issue 3910 `bottleneck-map.json` finding
`common-web-header-lookup` connects Bun `findHeaderName` self sample shares
of `0.05527638190954774` and `0.04841006169909824` to the shared Web
response facade. These are historical sample shares, not CPU time or
measurements of the new implementation.

Each lookup previously allocated `Object.keys(headers)` and a `find`
callback. The new loop searches the current enumerable keys and accepts only
own properties, returning the first case-insensitive match without that
temporary key array or callback. No persistent index or header cache is
introduced. Direct header addition, replacement, deletion and whole-map
replacement remain visible. Complexity remains a linear scan per lookup;
lowercasing and necessary native `Headers` conversion are not eliminated.

The request-ID candidate is not implemented. Existing `hasAbsentRequestId`
is consulted on the dispatch request, while Web creation does not mark
absence and generic dispatch creates another request owner. Extending that
path would require separately proving mutable normalized headers and
owner-bound propagation. `cloneWebHeaders` sample cost alone does not
establish that request-ID lookup owns all of that cost.

## Deterministic regression

`red.log` records:

```sh
pnpm vitest run --project packages packages/runtime/src/web.test.ts -t 'response header key arrays' --maxWorkers=1
```

It failed at the allocation assertion before production edits:
`AssertionError: expected 9 to be +0`. A real Web factory, dispatcher,
controller and default security middleware produced the correct native
JSON response while allocating nine `Object.keys` response-header arrays.
The observer delegates to the original built-in and counts only the exact
response map; it is restored in `finally`.

`focused-green.log` records the same regression passing inside the accepted
six-file suite (195 tests). The zero count concerns these explicit key arrays,
not all engine allocations or total request CPU. Additional regressions cover
first casing among duplicate case variants, direct mutation/deletion, map
replacement, inherited/non-enumerable properties, arrays, ordered independent
cookies, Vary, Content-Type, response memoization, commitment and body-forbidden
204/205/304 statuses.

## Completed local checks

| Evidence | Command or check | Result |
| --- | --- | --- |
| `install.log` | `pnpm install --frozen-lockfile` | exit 0; initial provisioning 3.3 seconds |
| `harness-install.log` | `pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace install --frozen-lockfile` | exit 0; initial provisioning 4.3 seconds |
| Tool diagnostics | LSP on `web.ts` and `web.test.ts`, before build | no diagnostics |
| `focused-green.log` | accepted V04 six-file Web/dispatcher/security Vitest command | 6 files, 195 tests; exit 0; 24.77 seconds |
| `adapters.log` | accepted V08 Bun/Deno/Workers/Next source Vitest command | 30 files, 319 tests; exit 0; 98.65 seconds |
| `governance.log` | changed-file Biome lint, public-export TSDoc, platform consistency governance and its Vitest test | passed; 475 governance tests |
| `changeset.log` | `pnpm verify:changeset-release-lane -- --lane=stable --base-ref=1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18` | exit 0 |
| `build.log` | `pnpm --filter '@fluojs/runtime...' build` followed by `pnpm build` | both exit 0 |
| `typecheck.log` | runtime/HTTP typechecks, `tsc -p examples/tsconfig.json --noEmit`, isolated harness typecheck | exit 0 |
| `examples-harness.log` | examples Vitest and isolated harness test commands | 102 examples tests and 139 harness tests; exit 0 |

The patch Changeset affects only `@fluojs/runtime`. There is no public API,
default or lifecycle contract change requiring README EN/KO edits. No historical
issue 3910 evidence is altered.

## Failed command and remaining checks

`governance.log` also retains an unsuccessful `pnpm verify:release-readiness`.
Its implementation launches root build, full typecheck, all four Vitest projects
and sandbox matrix, not just metadata checks. It was mistakenly started beside
a package test whose global setup rebuilds dist. The concurrent build failed
with missing `@fluojs/diagnostics` declarations in notifications/cache-manager.
This is a local verification scheduling mistake, not an established production
regression or a PASS. A subsequent sequential closure and workspace build passed.

Full release-readiness is not rerun because this assignment explicitly excludes
root full CI. All later dist rebuilds, typechecks and package tests are sequential.
CLI sandbox and 16-host correctness smoke are still pending at this report head.

## Lead-owned acceptance

No performance, load or profiling invocation is performed here. There is no
exact-head BEFORE/AFTER throughput, tail-latency, CPU/request or memory verdict.
The lead must measure the preserved base and returned implementation commit with
fresh builds, covering Bun, Deno, real local workerd and production Next for
this Web-only production change. Historical sample shares and local correctness
checks are not numerical acceptance. Exact-head review and GitHub CI remain
separate later gates; this local implementation is not issue completion.

## Lead completion of local correctness

The worker returned before its local commit and later resumed from an old
monitor. The lead cancelled that worker and its own overlapping verification,
preserving both attempts. No interrupted command is counted as passed.

The lead sorted the touched test imports, confirmed clean LSP diagnostics and
inspected the complete source diff. Sequential recovery completed the workspace
build and runtime/HTTP typechecks. The first recovery then failed Biome import
ordering; the corrected run passed Biome/TSDoc/platform governance and all 29
Web tests before the overlapping continuation was stopped.

`../lead-sandbox-20261008.log` records a fresh complete CLI sandbox matrix in a
unique directory outside the repository, ending with
`LEAD_3911_SANDBOX_PASS` and monitor exit 0. Previously completed 195 focused,
319 adapter, 102 example and 139 harness tests remain retained evidence.

`../lead-host-smoke-20261008.log` ends with
`LEAD_3911_HOST_SMOKE_PASS` and monitor exit 0. The actual
`results/correctness-smoke.json` contains 176 conditions across 16 targets and
4,400 completed requests. Every condition has zero errors, timeouts, non-2xx,
body mismatches and status mismatches. It is explicitly marked
`notPerformanceBaseline: true`; these results prove correctness, not speed.

The corrected preflight keeps ordinary local verification focused. Full
repository verification remains required in final-head GitHub CI; the failed
local release-readiness invocation has not been relabeled as successful.

## Follow-up candidate: response-owned header index

The first candidate at `fbae0e55bd6a8438715f2002af74c2e6c385fe96` did not establish
a speedup. Its bounded Bun comparison retained six BEFORE and six AFTER samples:
Fluo medians changed by +1.55% throughput, -5.58% p99, -1.25% CPU/request and
-2.04% sampled peak RSS, but throughput/latency/CPU ranges overlap. A separate
CPU pair had 23.40% versus 24.04% inclusive `findHeaderName` samples; removing
the callback changed self attribution rather than proving less total work.
Those original timings and profiles remain INCONCLUSIVE and retained outside
this source commit.

The next candidate indexes names only while the response owns its initially
empty header map. Reading `headers` permanently discards the index because the
returned record can be mutated directly. Assigning a replacement map also
discards it. Subsequent lookups use the live own-enumerable search, retaining
first casing, deletion, replacement, arrays and cookies. Internal response
methods use the same backing record without falsely treating their own access
as external mutation.

The first new test incorrectly counted all pipeline normalization as initial
security-header work. Diagnostic stacks identified one initial write and three
later response-policy/live-lookup calls. The corrected measurement boundary is
the controller entry: disabling the index produced 8 normalizations against
the expected 1, with an assertion-level failure in
`../header-index-mutation-red-20261008.log`. Restoring the index passed all 515
tests in 36 related files and runtime typecheck, recorded in
`../header-index-green-corrected-20261008.log` with exit 0. Temporary stack
logging and the mutation were removed.

This is a verified correctness/cost-count candidate, not a measured speedup.
Real-host revalidation and exact-source performance comparison for this new
candidate remain required; the first candidate's receipts are not relabeled.
