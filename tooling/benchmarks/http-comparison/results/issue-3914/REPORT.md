# #3914 local comparison harness extension

## 2026-10-12 Linux CI fixture correction

The current fixture-fix preflight is
`23f4b94b097460c5c4c7c8bf9edce8c0e001211907665122b1e5df735b7f2fa3`.
The initial Linux CI at `5f4dbb4f095ecd64946e7ce6b4d5a5c0b7c17815`
(run `38198508467`, static job `114647615234`) recorded 364 passing and 76
failing harness tests. Two test fixtures sampled their own collector PID,
which included a transient `ps` child that had exited before its procfs read.
One methodology assertion and the profiling hook's dependent cases therefore
failed. The CI source guard also correctly detected outputs left by the paired
test suites.

The corrected fixtures start a real HTTP serving child only after the parent
has subscribed to readiness and exit events. They assert that its PID differs
from the sampler, retain the real HTTP failure and profiling assertions, and
await owned-child teardown. Each paired suite removes only its own newly
allocated temporary directory after its assertions and child teardown.
Existing historical raw artifacts are not removed; their content-preserving
relocation is recorded under
`.omo/verification/3914-preserved-check-artifacts-20261012/`.

Production resource sampling, collectors, validators, dependencies, public
packages and numerical rules remain unchanged. No procfs error is swallowed,
no ignore rule or source guard is relaxed, and no assertion is skipped.
The host harness completed 440 tests: 439 passed, one existing Linux-only
skip, zero failures. Typecheck, changed-file lint, LSP and the absence of newly
leaked fixture paths were checked. Source-bound details are in
`.omo/verification/3914-fixture-fix-host-validation-20261012.json`.
Focused Linux execution and new-head GitHub CI are separate gates, not
inferred from the macOS result. They do not collect a performance matrix.

The owner explicitly instructed this session to skip full local CI.
It is waived, not executed or passed; focused checks, exact-head reviews
and full GitHub CI remain required. The earlier reporting increment below
records its historical state and does not claim that these fixture files
remain byte-identical after this correction.

## 2026-10-12 owner-approved reporting increment at 5f4dbb4f0

The owner decision "미입증 후보 제외" is recorded in
`.omo/verification/3915-unproven-candidate-exclusion-20261012.json` as
`OWNER_APPROVED_COMPLETION_SCOPE_AMENDMENT`. The accepted report-only preflight
is `1a018aa1cf3bb25ffaceac8b972be30fdeaa1c7f25105a40f0b5ef4a8dda2857`.
It supersedes the earlier requirement to obtain new passing full BEFORE/AFTER
matrices and candidate comparisons before completing this work unit. Those
requirements are superseded, not fulfilled or PASS.

The deliverable is the retained verified harness and an honest Workers/Next
measurement-and-limitations report, with unproven runtime candidates excluded.
The existing 71-file harness change and meaningful correctness regressions are
retained. This reporting increment changes only `REPORT.md` and `manifest.json`
after `c169f9095a76b4b7d139427ff3cabf653413cdd0`; executable files, tests,
fixtures, dependencies and lockfiles remain byte-identical. The public package
tree remains `f0a7ae832640b0cb252b832dd8b986be7caaeb92`, identical to approved
base `1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18`. No public optimization,
API change, candidate-only Changeset or React implementation is included.

Performance acceptance is **NOT_ESTABLISHED**. Engineering workflow completion
is separate: this local implementation does not complete exact-head reviews,
full GitHub CI, remote-head equality, mergeability, merge, cleanup or the lane
retrospective. No PR or remote CI is currently recorded. Historical reviews
at `c169f9095` under policy
`80651d95a14056c8512f960a787a501a141f6c3002b8e6f9f4e05f57abb82365`
were contract/code PASS and verification NEEDS-HUMAN-CHECK; they are not rebound
to this new contract. The interrupted release-readiness remains without a
completed verdict.

### Environment-specific numerical disposition

| Environment | Retained evidence | Final interpretation |
| --- | --- | --- |
| Local direct workerd, native/Fluo | NAS 44/44 finite conditions, 180 requests, 220 artifacts | Correctness only; separate ordinary timing and instrumented CPU capture, not deployed isolate cold or capacity |
| Next production App Router, Node | Included with Pages in NAS 88/88 finite conditions, 360 requests, 440 artifacts | Correctness only; Next host/framework costs are not Fluo-exclusive |
| Next production Pages Router, Node | Separate builds and serving entries from App Router in the same 88-condition receipt | Correctness only; Node socket ownership and demand-driven bridge preserved |
| Deployed Workers immutable Version URLs | 44/44 finite conditions, 180 new requests, cumulative 204/250 controlled direct requests | Correctness only; prior production failures preserved; production traffic allocation and performance NOT_ESTABLISHED |

The NAS finite receipts are
`.omo/verification/nas-workers-next-20261011/workers-summary.json` and
`next-summary.json`: collection head
`526ac5b3514ff0c18e48c76bfa379c00b3a379dc`, framework source
`1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18`, total 132/132 conditions,
540 requests and 660 verified artifacts. They bind native/Fluo,
default/equivalent, concurrent first requests and same-host subsequent requests.
The runtime is Linux x64 kernel `4.4.302+`, workerd `2025-06-04`,
Node `24.21.0`, Next `16.3.5`. Observed execution on that NAS does not extend
official runtime support. Each production Next build ID, entry/trace hash,
Worker bundle/config hash and serving identity remains in its original receipt.
Deployed collection retains source `f18b264fd26ea2e5818d374b080d0640645d549e`
and its original receipt hash, not this report's commit identity.

The BEFORE duration calibration at
`.omo/verification/nas-host-baseline-3914-20261011/summary.json` retains
263 completed samples of 264 expected, 2,454,837 measured requests and one
failed condition. Of the completed samples, 241 fall below the minimum 20,000
requests. The original uninstrumented
`default/native-nextjs/stage-routing-params/concurrency64` measurement completed
1,666 requests with 7 errors and 7 timeouts; cold and warmup passed. This is
partial BEFORE calibration, not a complete baseline, candidate comparison,
budget PASS or proof of a Fluo source defect.

The separate `.omo/verification/nas-next-timeout-diagnostic-20261011/analysis.json`
retains two instrumented conditions and 8,167 requests at the same collection
head `c169f9095a76b4b7d139427ff3cabf653413cdd0`.
The original analysis retains that identity; the
diagnostic did not reproduce the timeout and neither replaces the original
failure nor establishes its cause. Cgroup CPU remains `unsupported` and Linux
pressure remains `read-error`, not measured zero.

Client-observed latency includes HTTP transport/network and ordinary host
handling. Local launch-to-ready includes startup attestation; first-request
latency includes native host work and, for Fluo Next, lazy import/bootstrap.
Warm requests reuse the host. Process CPU/RSS and instrumented profiles can
observe host/framework costs but do not isolate Fluo-exclusive request cost.
Local restart is not an observed deployed isolate cold boundary. Deployed
framework-exclusive CPU/RSS, isolate cold and capacity remain unestablished.
Diagnostic/instrumented samples are not ordinary uninstrumented acceptance.

### Preserved source-bound verification and contracts

`diagnostic-guard-20261011/README.md` and its original logs bind the unchanged
source at `c169f9095`: 440 harness tests, 439 pass, one existing Linux-only skip,
zero failures, exit 0, plus typecheck, lint and LSP. The strict offline recheck
`.omo/verification/3914-diagnostic-guard-recheck-20261011.json` retained original
raw files, hashes and producer heads. It is reevaluation, not new collection.
The scoped Bun/Node calibration verdicts do not become Workers/Next acceptance;
Fastify/Express INCONCLUSIVE and all original FAIL, unsupported and incomplete
records remain. These unchanged suites and real hosts are not rerun or claimed
as newly executed for this report-only contract update.

Serving executable/artifact authentication, cumulative bounded hashing,
direct workerd control-fd readiness/listener ownership, Linux procfs CPU
precision, continuous cold/warmup/measurement generator and diagnostic
environment/phase/resource-marker rejection remain intact. Bun A/A/A/B and
Node 60s/180s fixed-order protocols retain source-specific calibration/candidate
binding, budgets and failure decisions; no thresholds, outliers or collectors
are changed and no additional measurement is requested here.

`CONTRIBUTING.md`, `docs/contracts/behavioral-contract-policy.md` and both locales
of the Workers and Next package READMEs remain authoritative. Workers native
Request identity, header snapshots, original-body readability, raw byte limits,
multipart ownership, request-local env/executionContext, abort, waitUntil,
SSE/WebSocket drain, listen binding freeze, shutdown 503, bounded close and
lazy restart remain unchanged. Next preserves original Request/method/body,
headers/Set-Cookie, parser/auth ordering, HEAD single dispatch/bodyless cleanup,
request-scope disposal and Pages `bodyParser: false`, bounded demand-driven
input, backpressure, disconnect abort, upload drain and host socket ownership.
Per-closure lazy Promises and opt-in same-global keyed application Promises
retain shared bootstrap, cached failure, closed graph and key/process/global
isolation without request-data sharing, eager bootstrap, retry/reset/reopen
or process signal ownership. Security headers, middleware ordering and Deno
public support remain; Deno stays excluded from performance scope.

### Local archive provenance and later cleanup boundary

The completed pre-exclusion archive is local-only:
`.omo/verification/unproven-exclusion-archive-20261012/receipt.json` and
`plan.json`. Command exit is 0 and git bundle verification exit is 0.
`candidate-history.bundle` SHA-256 is
`be6410c2898cb3d3aa331990aa9d0e5c5f235ec273628f1c56ba9de9ca1249d4`;
`worktree-raw-before-exclusion.tar.gz` SHA-256 is
`00cfc4ebe237154e8a1330fb7fd9ad6d546b9698ae35b3e52dd224104b3f5b98`,
with 5,235 members and archive listing exit 0.
The plan retains original roots for issue-3911 profiling, issue3912, issue3913
and issue-3914 raw results, with `.omo/verification/`, `.omo/retros/` and the
two issue3910 archives separately preserved. `originalFilesRemoved` is false.
Historical commits and untracked paired-ab-check/paired-node-check directories
remain preserved and unstaged.

These ignored `.omo` paths and raw files are not remotely downloadable
artifacts. The snapshot does not authorize cleanup or establish that evidence
created afterward is in a final cleanup archive. Before eventual cleanup, the
lead must separately confirm preservation of later evidence.

## Historical implementation and measurement chronology

The following original reports and plans retain their historical facts.
Earlier full-matrix/candidate-comparison requirements and availability claims
are superseded only as described above and in the dated evidence update.
The legacy manifest fields retain their original receipt/check meaning; its
`completionScope` and `currentEvidence` describe the current disposition.

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

## 2026-10-11 evidence update

This section supersedes earlier environment-availability statements, not their
historical results. It does not establish issue completion or a performance
improvement in a public package.

The direct local workerd path now authenticates the native process, listener,
bundle and configuration without an ordinary-timing inspector. Its finite
correctness and separate CPU capture evidence are described in
`direct-workerd-increment.md`. The earlier Wrangler-host `unsupported` records
remain preserved and are not reclassified. Local process identity is not proof
of a deployed isolate's cold-start identity.

Actual Workers Free deployment correctness was subsequently verified at source
`f18b264fd26ea2e5818d374b080d0640645d549e`: 44 immutable Version URL conditions,
180 new controlled requests, no invalid attempts and exit 0. Including the
preserved production attempts and diagnostics, the controlled total is 204 of
the declared 250-request cap. Two failed production-routing attempts remain in
their original receipt. Version URL correctness does not establish production
traffic allocation, isolate cold start, framework-exclusive CPU/RSS, throughput,
capacity or performance-budget acceptance. No paid plan or add-on was enabled.
The exact summary is `.omo/verification/3914-version-url-correctness-summary-20261011.json`;
the raw receipt is `deployed-version-url-correctness-20261011.json`.

The measurement corrections and subsequent experiments have separate verdicts:

| Source or experiment | Completed evidence | Scope of conclusion |
| --- | --- | --- |
| `70407cfe9` CPU precision correction | Independent Linux process RED/GREEN against procfs counters; explicit 0.01-second quantum | Repairs precision, not all variability |
| `aaaa62305` original paired A/A | 12 runs; 46,766,937 measured requests | INCONCLUSIVE; original records retained |
| `9d1d0addc` continuous local generator A/A | 12 runs; 47,216,486 measured requests | Within unchanged budgets for one Linux/Bun condition only |
| Shared header candidate on OrbStack | 12 runs; 48,134,492 measured requests | INCONCLUSIVE: p95 paired CV 5.323% exceeded 5%; no budget breaches |
| Baseline-only scheduling diagnostic | Four instrumented runs; 15,735,475 measured requests | Diagnostic only; not candidate acceptance |
| `b7b4aaa5f` NAS same-code A/A | 12 runs; 4,607,948 measured requests; 1,144.898 seconds | Within unchanged budgets for the declared NAS/Bun condition only |

The NAS condition is Bun 1.4.2, Linux x64, `stage-minimal`, `equivalent`,
concurrency 64, 30-second warmup and 60-second measurement. Both framework arms
use the same baseline package tree from
`1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18`. The NAS's Linux 4.4 kernel remains
outside the documented Node 24/Bun support limits despite observed compatibility.
The calibration does not change that support boundary or establish capacity.
Initial NAS provisioning took 355 seconds; fresh build and 68 passing focused
tests took 635.827 seconds, separately from measurement. All 15 recovered raw
JSON files matched their NAS SHA-256 values. The complete binding and raw paths
are in `.omo/verification/nas-benchmark-20261011/summary.json`.

The Node-family collector at
`6ddddba7b8e1b0519ff6760ae98931152869f661` separates explicit calibration and
candidate modes for Node.js, Fastify and Express. Its full macOS harness run
passed 369 tests with one Linux-only skip and zero failures; focused tests,
typecheck and changed-file lint also passed. This is implementation validation,
not Linux Node candidate acceptance. A Bun calibration cannot satisfy its
platform-specific Node calibration binding.

At the time of this update, remaining work included the source-bound shared candidate comparison, all
required affected conditions, local Workers and production Next App/Pages
comparisons, explicit deployed metric limitations, final exact-head reviews,
remote CI and lane completion. No additional platform-specific optimization is
claimed without a confirmed Fluo-exclusive bottleneck. The owner-approved
2026-10-12 scope above supersedes those full-matrix and candidate-comparison
requirements, not their missing numerical acceptance. These private benchmark
and evidence changes do not modify public package behavior or require a
Changeset.
