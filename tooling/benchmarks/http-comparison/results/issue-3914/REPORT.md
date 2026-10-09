# #3914 local comparison harness extension

## Scope and release impact

The existing comparison runner, target launcher, traffic validation, serving
subject discovery, raw artifact limits, and provenance collector are reused.
`native-nextjs-pages` and `fluo-nextjs-pages` are explicit opt-in targets. The
16 default targets, App Router names/ports, and legacy raw schema remain intact.
Pages uses the same 11 workloads under `/api`; both controls receive that prefix.
Next owns native Pages parsing and response sockets. The native fixture calls
the existing native workload directly, not a Fluo adapter or Pages bridge.
The Fluo fixture uses the shipped request-lazy Pages handler and
`bodyParser: false`. No runtime, public package, lockfile, or React application
source changed; no Changeset is required under CONTRIBUTING.md.

## Correctness reproduction

Build the affected platform and validation closures first, with frozen root and
isolated harness installs. Do not run a dist writer while real hosts are active.
Use a unique output filename and free port range:

```sh
pnpm --filter '@fluojs/platform-cloudflare-workers...' \
  --filter '@fluojs/platform-nextjs...' --filter '@fluojs/validation...' build
cd tooling/benchmarks/http-comparison
BENCH_PORT_BASE=35914 \
BENCH_CORRECTNESS_OUTPUT="$PWD/results/issue-3914/<unique-run>.json" \
  node --import tsx tests/fixtures/host-correctness.mts
```

This is finite correctness, not load or profiling. Each condition checks two
concurrent initial requests per workload request and a same-host subsequent
request, asserting status, exact response bytes, JSON content type, and
configuration-appropriate security headers. Existing package regressions
remain authoritative for raw bodies, cookies, HEAD, abort, pending-read
cancellation, backpressure, application generations, and host close ownership.
Identity-only inspector discovery retains the actual serving process/isolate
and runtime through the existing collector without starting a profiler.
Next build ID, trace hash, and exact serving entry hash are distinct for App
and Pages. The source snapshot and both lockfiles are retained by provenance.
Correctness receipts from a dirty implementation checkout are not a clean
performance baseline.

## Cold/warm interpretation

`coldStart.host` adds explicit environment and boundary metadata while retaining
the existing `processToReadyMs`, `firstRequest`, and `boundary` fields.
Host process readiness is separate from the first HTTP request. A Fluo Next
first-request envelope includes lazy backend import/bootstrap and ordinary host
handling; it is not exclusive bootstrap CPU time. Subsequent requests use the
same host. Worker application generation and actual deployed isolate cold are
explicitly `not-observed`, not inferred from local restart or first request.
Per-closure lazy promises are not described as globally keyed applications.

## Measurement handoff and deployed gaps

No new performance, load, or profiling run belongs to this implementation.
Apply the same harness patch to BEFORE and AFTER framework heads, distinguish
framework git identity from harness snapshot identity, and perform successful
fresh builds at each head. The lead owns exclusive serialized representative
measurement and its verdict. For Pages select
`BENCH_TARGETS=native-nextjs-pages,fluo-nextjs-pages` in the existing runner;
retain `BENCH_SUITE=all`, both default/equivalent configurations, concurrency
1/64, three repeats, five-second warmup and fifteen-second measurement.
Existing App/Workers selection and commands remain available. Profile capture
uses the Pages serving entry and Turbopack build identity without relaxing
traffic, subject, provenance, raw-limit, or failure validation.

Actual deployed Workers acceptance remains unconfirmed. Missing facts are the
account/project and endpoint, deployment authority, credential availability,
cost budget/quota, host telemetry access, and generation evidence establishing
an actual isolate cold boundary. No credential values were collected, no
deployment occurred, and local workerd does not satisfy deployed acceptance.

The #3910 REPORT.md and bottleneck-map.json remain historical observations,
not #3914 exact-head measurements. Shared Workers header costs belong to #3911
in runtime/src/web.ts. Next loadManifest/addRequestMeta also occur in native
profiles; neither they nor the workerd cross-request warning establish a safe
Fluo-exclusive optimization. No speculative runtime optimization is included.

## Preserved attempts

The initial Pages selection regression failed because those targets were
unknown; the existing selector passed after extension. Original RED and
build/GREEN logs are retained.

Two initial finite correctness attempts ended with `UND_ERR_SOCKET` from the
Fluo local workerd host, after 79/132 and 86/132 completed conditions. Their
partial receipts and logs remain unchanged.
They overlapped the required governance command's dependency rebuilds; the
socket error is not labeled a proven runtime bottleneck. The correctness client
now prevents socket reuse across host restarts, and subsequent verification is
serialized after dist writers complete. No retry hides a failed request.

## Local verification outcome

The exclusive final run completed 132/132 conditions and 540 real HTTP requests
across local Workers, production Next App, and production Next Pages, each
native/Fluo and default/equivalent. All status, exact-byte, content-type and
security-header assertions passed. The 660 retained raw subject/protocol/host
artifacts passed path containment, byte-count and SHA-256 verification.
Actual serving runtimes were Node 24.20.0 and workerd 2025-06-04; Next was built
from the frozen 16.3.5 installation. `manifest.json` binds the unique raw paths.
Raw files remain local rather than inflating the source commit.

The existing harness suite passed 142 tests. Workers package contracts passed
54 tests, Next package contracts passed 105 tests, shared Web portability passed
47 tests, and focused governance passed 475 tests. These are local correctness
and contract results, not full issue/performance acceptance or independent
review results.

`pnpm verify:release-readiness` was attempted but interrupted by the initial
watcher's timeout during its full build/typecheck/test sequence. It has no
completed verdict and is not marked PASS. Its runner was confirmed gone.
It was not rerun as full local CI under the focused-only stage instruction.
The interrupted suite left
`packages/cli/src/fixtures/typegen-check-process-WawAA2/` untracked; that
out-of-scope disposable fixture is preserved, excluded from the commit, and
not repaired or cleaned up here.
Its exact files are:

- `packages/cli/src/fixtures/typegen-check-process-WawAA2/app.ts`
- `packages/cli/src/fixtures/typegen-check-process-WawAA2/tsconfig.json`
- `packages/cli/src/fixtures/typegen-check-process-WawAA2/generated/react-pages.ts`

The lead confirmed that full release-readiness local duplication is not needed
for this ordinary harness change. Final exact-head remote CI remains mandatory;
it is not part of this local stage. Heavy build/test/install/real-host and
measurement work remains paused during the lead's diagnostic slot.

The stock `pnpm --filter @fluojs/platform-nextjs test:e2e` was not run because
its hardcoded persistent evidence root is `.omo/platform-nextjs-e2e-*`, outside
this stage's assigned evidence scope. This does not claim that the stock E2E
passed. The comparison fixtures themselves were production-built and exercised
over HTTP as reported above; the later whole-issue gate still owns any required
stock E2E evidence with an approved output boundary.

## Lead stock E2E verification

The preceding stock E2E limitation describes the worker handoff. The lead ran
the existing suite without modifying its tests or output boundary. The first
attempt stopped at `Missing react`; its log and partial evidence remain retained.
Pointing `FLUO_E2E_NEXT_ROOT` to the existing frozen comparison-harness installation
resolved the dependency lookup without installing or changing dependencies.

On source head `481f601e46e44f2f5cf6118f59a8db817f4a1234`, the existing Next
production E2E passed all 54 tests with exit 0. The raw log is
`lead-next-e2e-benchmark-deps-20261008.log`; native test evidence is retained at
`.omo/platform-nextjs-e2e-QFNc8U` in this worktree and must be archived before
worktree cleanup. This closes the stock E2E gap, not representative performance,
full remote CI, or actual deployed Workers acceptance.

The lead archived all local issue-3914 evidence, both stock E2E attempts and the
three interrupted CLI fixture files outside the worktree at
`.omo/3914-local-evidence-481f601e-20261008.tar.gz` (809,165 bytes; SHA-256
`75528788303eedac10ee0930e54262673578f046f7536539dc844486b69a7b18`).
The complete archive read passed before removing those three generated,
untracked CLI files. No tracked CLI or React implementation was changed.

## Timing evidence repair and Linux verification

Commit `bb1bda5f9c2c5ef0d6d0cf20b811da08779e08df` preserves successful warmup
measurements and authenticates the measured process using startup identity,
runtime/executable and source/build hashes, and the OS listener owner.
Startup hashing changes the process-to-ready boundary; it does not install
request-path profiling. The harness suite passed 151 tests, typecheck and
changed-file Biome. Raw evidence is under `timing-repair-1791512355621/`.

The finite actual-host check recorded 12 targets with three warmup requests
and three measured requests each. Ten Node/Bun/Deno/Next App/Pages targets
authenticated successfully. Both local Workers targets remain explicitly
`unsupported` / `not-certified`: launcher stdout cannot authenticate the
application isolate, and the existing inspector-based method does not
establish uninstrumented timing. These records cannot certify Workers
performance. No deployment or final performance matrix was run.

The lead found that the canonical Linux image lacks `lsof`. A real Linux
regression run reproduced `spawn lsof ENOENT` in eight of nine tests
(`timing-linux-lsof-red2-20261009.log`). The earlier host-mounted esbuild
attempt used a macOS binary and never reached the regression; a subsequent
npm-exec attempt ran no tests. Neither is a passing check.

Linux now verifies listening TCP socket inodes against the serving process's
file descriptors through `/proc`; macOS retains its existing OS listener
lookup. The exact same canonical image, without installing `lsof`, passed all
10 identity tests after the fix. Only the matching esbuild 0.28.1 Linux binary
was installed inside the disposable container. The added foreign-listener
case rejects an otherwise valid identity when another process owns the port.
macOS passed the same 10 tests, harness typecheck, changed-file Biome and
diff checks. See `timing-linux-procfs-green-20261009.log` and
`timing-mac-procfs-green-20261009.log`.

Cloudflare account clarification timed out. Account availability and external
deployment authority remain unconfirmed; no login or deployment was attempted.
All other outstanding issue acceptance and exact-head gates remain open.

## Bounded startup hashing

A separate BEFORE-only on/off diagnostic identified a measurable startup
observer burden: authenticated runs used 119.48-122.73 MiB, compared with
79.91-82.41 MiB with startup attestation disabled. The three paired deltas
were 38.52, 39.19 and 42.83 MiB. These short diagnostic runs are not candidate
acceptance and do not establish a production leak or explain every prior
RSS outlier. The disabled arm deliberately lacks an authenticated receipt.

The bootstrap previously read each file, including the serving executable,
into a whole Buffer before hashing. A deterministic child-process regression
observed `Hash input exceeded 64KiB: 121911744 bytes` before the fix.
It checks actual hash-update inputs and exact SHA-256 equality, not prose,
source strings or GC timing. `timing-hash-buffer-red-20261009.log` preserves
that assertion-level RED.

The bootstrap now streams file hashing in 64 KiB chunks. Its digests, nonce,
runtime/executable, build-file and OS listener identity checks are unchanged.
The full harness passed 153 tests plus typecheck and Biome; Linux passed
all 11 identity regressions. The actual-host check passed 12 conditions,
with 10 authenticated Node/Bun/Deno/Next App/Pages hosts and the same two
explicitly unsupported Workers hosts. Logs are `timing-hash-stream-green-20261009.log`,
`timing-linux-stream-hash-green-20261009.log` and `stream-hash-hosts-20261009.log`;
the latter's raw receipt is `stream-hash-hosts-20261009.json`.

The unchanged on/off diagnostic after the fix observed authenticated RSS of
84.95-87.59 MiB and disabled RSS of 79.98-80.73 MiB, paired differences of
4.97, 6.86 and 6.86 MiB. This confirms reduced observer burden, not zero
overhead or a final full-duration regression verdict. No amount is subtracted
from acceptance RSS; both future arms must use the same repaired harness.
Budget limits and all historical INCONCLUSIVE results remain unchanged.

Both raw diagnostics, summaries and their script are preserved under root
`.omo/verification/3911-bootstrap-*`. The temporary worktree diagnostic script
was copied there unchanged before removal. No framework package source changed.
