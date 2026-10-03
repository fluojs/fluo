# React application performance comparison

<p><strong><kbd>English</kbd></strong> <a href="./react-performance-benchmarks.ko.md"><kbd>한국어</kbd></a></p>

This guide describes the isolated [React application comparison](../../tooling/benchmarks/react-app-comparison/README.md)
for [#3883](https://github.com/fluojs/fluo/issues/3883). The [full-stack product
contract](../contracts/react-fullstack-product.md) names the target journeys, not measured
performance or a claim that every journey is already shipped.

## Workload and correctness first

Four independent production applications implement one seeded public product listing and
detail, an authenticated CRUD operation, and a jukebox that navigates while retaining
its shared resource. Use the same number of records, initial and edited values, validation
boundaries, authorization decisions, status and response meanings, static assets, and
interaction assertions. A private response must not become public-cacheable merely to
equalize a competitor's result. Preserve both each framework's native/default caching
and a separately labeled matched-cache comparison. Next.js App Router's RSC transfer
model and the hydrated models' client code/work are recorded separately; transferred
JavaScript alone is not a whole-page equivalent.

Correctness must pass against the actual production HTTP and browser surfaces before
timing. Failure, sign-out, and navigation must remain observable in the same app. An
unimplemented product journey or an unavailable metric is not a passing measurement.
The existing [Vite SSR example](../../examples/react-vite-ssr/README.md) covers a smaller
baseline and is not, by itself, proof of full CRUD or long-session jukebox behavior.

## Measurements and decisions

The suite's machine-readable `baseline.json` owns the absolute budgets, relative bands,
profiles, run/warmup counts, aggregation, noise handling, and outlier policy. Preserve
the file and its review history: relaxing a budget requires an explicit reviewed change.
The first `--mode discovery` captured the measured starting point without treating a
confirmed deficit as a setup error; its recorded performance verdict is `fail`
even though the discovery command completed successfully. The separate
regression run omits that flag and exits nonzero on either outcome. Actual optimizations
against frozen budgets belong to #3884/#3885, not to a baseline adjustment in this issue.
Record cold and warm TTFB, shell arrival/LCP, hydration and main-thread work,
interaction-to-pending and interaction-to-approved-view p50/p95, transferred and
compressed JS/CSS, request counts, throughput, error rate, server CPU and RSS.
Development cold readiness and React, CSS, and server edit-to-visible require separate
runs, not production-navigation timings repurposed as dev measurements.
The TanStack fixture pins `react` and `react-dom` to `19.2.8` in both its
manifest and isolated lockfile; production and development results must use
that same resolved graph.
The current Fluo fixture rebuilds and restarts before a browser reload rather
than claiming Fast Refresh; the TanStack route loader edit restarts its
development server before reopening the changed page. Both timings include
their actual restart paths. Next.js CSS edits likewise use a server restart
and reopened document after the tablet-class browser failed to observe CSS HMR;
Next.js server edits also restart and reopen after a source update did not
become browser-visible. Neither measurement is a native HMR time. The Fluo fixture's build/restart harness is not
the generated starter's `fluo dev` Vite middleware path: its measurements
cannot establish canonical Fluo development latency or peer development parity.
Shell arrival uses first-contentful-paint; initial main-thread work uses CDP
`Performance.TaskDuration`, which includes work outside hydration. The raw trace
records these method labels and unavailable measurements rather than silently
equating RSC bytes to hydrated client work.
The common `react-initial-completion-v1` boundary replaces load-only cold sampling.
Before entry navigation, install CDP request observers and a React DevTools observer
that forwards an existing hook. In addition to document load, require an actual root
with `isDehydrated=false` and an element, no pending root lanes, and no fallback or
dehydrated Suspense in the committed Fiber tree. A commit with frozen passive mask
`10256` waits for `onPostCommitFiberRoot`; a subsequent commit without passive work
may complete directly. This observes synchronous passive effects and their scheduled
React updates rather than just the first root commit. Existing
`data-benchmark-hydrated` leaf-effect markers must also be true. Cold-owned
document/script/stylesheet requests must settle successfully by actual identity
before sampling cold CPU and asset/request inventory and triggering warm navigation.
DOM presence, arbitrary sleeps and network-idle are not completion signals.

Support is limited to the frozen production renderers `19.2.8` and Next's bundled
`19.3.0-canary-cbb046ab-20260731`, whose hooks/Fiber fields were checked. Timeout,
absent observer, unsupported renderer and failed initial resources produce a
nonzero/inconclusive run without load fallback. This does not guarantee completion
of arbitrary asynchronous effect work, future roots or background prefetch. Next's
native RSC prefetch is unchanged; pending/aborted requests stay separately recorded
and may still cause inconclusive results or error-budget failures. Raw
`timings.initialBoundary` retains renderer and commit/post-passive states,
load/completion/sample/warm timestamps, raw CDP metrics/paint entries, initial
requests and pending-at-warm identities. Requests retain loader/request IDs,
initiators, settlement phase/timestamps and cancellation. Existing raw-trace
authentication remains required.

Optional production `nativeLifetime` observation is disabled by default.
In a `run-gate.mjs` config, add
`{ "nativeLifetime": { "enabled": true, "python": "/opt/fluo-native-debug/bin/python" } }`
under `measurement`; the default never imports, starts, installs or requires
Frida/Python. The initial `chromium-native-lifetime-v1` adapter supports only
Linux/AArch64 ELF64 little-endian canonical Playwright revision `1228`
headless_shell, Chromium `149.0.7827.0`. The actual executed executable and
loaded renderer mappings must match SHA-256
`b6f53f7e40c3ad6727cb3a12536026dcd93281e5965923752c8130ed53e5e8c4`,
GNU build ID `afcd146a627911fb30269f995d093903636ed886`, the retained versioned
symbol/argument/clock schema, and agent/host source identities. A version string
or ELF offsets do not establish macOS, another binary or full Chromium support.
The external runtime is separately provisioned isolated Python `3.11.2` and
Frida `17.21.0`, with executable and dependency-file hashes checked.
The exact executable hash, runtime checks and opt-in reproduction commands are
in the [suite's observation boundary](../../tooling/benchmarks/react-app-comparison/README.md#opt-in-exact-native-lifetime-observation).

Hooks are ready before entry navigation. Owned browser-tree children receive
independent hooks before resume; CDP must prove their renderer role. Actual
`IdentifiersFactory::RequestId` calls, PID/process birth, Resource and independent
native Loader birth, and CDP target/session/request occurrence must form a unique
chain. Native loader pointers are not CDP `loaderId`s. Only pending records can
acquire cancellation from matching `Cancel` entry, its nested `HandleError` entry
and both normal returns strictly before the original cutoff. Monotonic clock
units must be verified; URL, nearest-time, GC and teardown inference are excluded.
Actual CDP terminals and original observations remain intact. Cancellation is
`request-failed`, `canceled:true`, and a failure in the existing errorRate;
status, body bytes, CDP error codes and settledTimestamp are not invented.

Native events buffer inside each process without per-event IPC. Hook costs are
not subtracted; setup/drain and separate observer costs are retained in provenance,
not separately measured. Drain follows unchanged throughput and `ps` snapshots,
before BrowserServer close, while preserving the original request cutoff.
Each owned session retains its Frida agent until natural process exit; observer
hooks stop and child gating is disabled at drain, while session detach/unload
follows process exit rather than preceding BrowserServer close.
An eternalized inert script prevents live-agent unload if failed/aborted
preparation forces bounded observer-child termination.
Resident memory/runtime overhead remains included without subtraction. The
Python host retains pidfd exit subscriptions through BrowserServer termination,
then finalizes evidence at the original cutoff. Main exit/error/disconnect and
available descendant wait statuses are retained; known abnormal exits are rejected
before NetLog parsing. Python exit 0 or successful detach is not browser health.
Reaped descendant statuses stay missing, not zero; main exit 0 does not prove
all descendants exited normally.
Separate post-drain shutdown observation classifies raw status 15 as intentional
only when the authenticated Chromium main's normal-shutdown caller, live owned
target PID/start identity, successful SIGTERM send, explicit-close ordering and
normal main exit all agree. Its IPC/setup cost is not subtracted. Zombie targets,
failed sends, missing callers, unknown causes and other abnormal exits are not
admitted; status 15 and missing statuses are never rewritten to zero.
Native/CDP, coverage/process, schema/source hashes, host logs and cleanup raw
artifacts stay in the fresh output root; `verifyTraceFiles` checks hashes, realpath
containment, run identity and reconciliation replay, including warmup and combined
traces. Unsupported environments, late attach, partial hooks, drops, incomplete
returns, script/transport errors, renderer exit before drain, identity ambiguity,
unverified child roles and worker/service-worker coverage are unavailable/inconclusive.
Success, failure, timeout and abort close observer sessions/children/listeners with
bounded event waits, retaining cleanup failures. The two earlier headless diagnostics
had no pending requests; their 36 already-canceled native bindings establish backend
viability only. New focused runtime checks likewise prove neither a missing-terminal
reproduction nor final performance PASS. The amended local representative pair
uses explicit opt-in OrbStack Linux ARM64 on the existing Apple M4 Pro host;
macOS native observation remains unsupported. Identical-final-collector before/after recollection
across four frameworks/profiles, existing samples/warmups/budgets/statistics and
historical fail/inconclusive preservation remain required.

The [isolated Linux invocation boundary](../../tooling/benchmarks/react-app-comparison/README.md#explicit-isolated-linux-representative-pair)
owns the command and frozen allocation: kernel
`7.0.14-orbstack-00380-ga7e0a2dc9535`, 12 logical CPUs/8392974336 bytes,
zero additional container quotas, actual Node `v24.21.0` and the recorded immutable
image ID. This is shared VM capacity, not a dedicated reservation.
`--isolated-container` performs real host Docker observation against the selected
running container and guest executable/SDK/browser/Python/Frida/schema/source
authentication per invocation. Preparation JSON or image identity alone is not
live evidence. The contained environment record's digest, immutable identity/config
hashes and distinct invocation evidence bind every production/dev/warmup/combined
trace, receipt and aggregate; missing/mismatched/tampered bindings fail closed.
Use the before hashes with `--environment-identity` and
`--environment-config-identity` together for after, preserve
identical actual tools/resources/config and schedule exclusive timing windows.
Passive generator CPU and ambient contention snapshots use existing timing
windows without changing CPU/RSS, capture or throughput boundaries or budgets.
Historical `baseline.json` stays untouched, including macOS Node `24.20.0`;
do not report a gain by comparing old macOS and new Linux observations.
Tracked representative defaults do not enable Frida. Ordinary default/CI/macOS
paths need no Docker/Python/Frida, and this local mode claims no cross-platform
performance acceptance.
Comparable identity excludes invocation locators and product commit/build
differences: actual absolute paths/config stay in evidence and provenance, while
tool/collector content hashes, allocation and normalized frozen settings must match
even when before/after worktree/build roots differ.

Historical load-only data sampled a different initial-work window and could trigger
warm navigation before cold modules finished; retained Linux evidence includes cold
script cancellations. Preserve all historical fail/inconclusive results. Recollect
the unchanged-runtime before and final-runtime after with the **same corrected
collector** before comparing them. All 22 metric names/scopes, budgets, five runs,
two warmups, alternating order, uncertainty rules and peer defaults remain unchanged.
Four-app readiness smoke is correctness evidence, not a performance PASS.
Separate `text/x-component` responses appear as their own encoded wire-byte
inventory; inline RSC data remains part of the HTML response. Neither number
is interchangeable with hydrated JavaScript bytes or initial main-thread work.

Every observation belongs to an identified commit, lockfile, production build command,
browser/runtime version, dataset, desktop or named low-end/tablet CPU/network profile,
cache mode, framework version, and individual raw trace. Warm up each target, alternate
the target order over independent runs, describe percentile aggregation, and retain all
samples, including noisy and over-budget ones. Check generator CPU headroom before
interpreting throughput; co-located generator contention is not framework capacity.
The named desktop viewport is 1440 × 900; the tablet-class viewport is 820 ×
1180 with 4× emulated CPU slowdown and a 1.6 Mbps downlink, not a physical
tablet result.
The native profile retains host caching; the matched-cache profile disables browser
cache reuse across all four applications. Compare actual wire bytes: a Fluo asset served
without content encoding is not equivalent to a competitor gzip response. Record
`contentEncoding` and `cacheControl` with the asset inventory, and keep authenticated
responses private in both modes. The matched mode does not rewrite response
cache headers or normalize gzip/Brotli/identity codecs; relative compressed
byte bands describe each host's observed wire cost, not equal-codec ratios.
An inconclusive sample is not a pass. Do not generalize an emulated profile to devices
that were never tested.

The pull-request smoke gates correctness and deterministic size/request counts without
using one shared-runner timing result to reject a merge. The separate representative
performance workflow fails on confirmed regression, retains the failure trace, and
reports uncertainty instead of silently marking it green. Neither workflow replaces
the local-only HTTP/DI benchmark policy or #3879's final product-journey acceptance.
The smoke is conditional within the existing `static` verification task, with a
distinct React selector; the HTTP comparison keeps its own conditional coverage.
The measured approval marker is rendered by the destination view. A replaced
document or failed response capture makes the run inconclusive, while genuine
request failures remain counted together with throughput errors. Decoded and
encoded asset bytes come from browser CDP network data events; a speculative
prefetch still pending at the capture boundary is recorded as pending and
makes the run inconclusive without fabricating byte counts or a request failure.

## Client delivery diagnostics

Issue #3884 adds a supplemental production observation path in
`tooling/benchmarks/react-app-comparison/src/client-delivery.mjs`. From the repository root:

```sh
node tooling/benchmarks/react-app-comparison/src/client-delivery.mjs \
  --build-root tooling/benchmarks/react-app-comparison/apps/fluo \
  --output-dir tooling/benchmarks/react-app-comparison/results/issue-3884/<fresh-invocation>/fluo
node tooling/benchmarks/react-app-comparison/src/client-delivery.mjs \
  --build-root examples/react-vite-ssr --lockfile pnpm-lock.yaml \
  --output-dir tooling/benchmarks/react-app-comparison/results/issue-3884/<fresh-invocation>/example
```

For an installed generated starter, pass its absolute path as `--build-root` and
the source repository as `--source-root`; its own frozen lockfile identifies the
installed package graph. The observer uses the app's production configuration and
records emitted module membership, static/dynamic import edges, rendered code bytes,
content hashes and duplicate module owners without adding chunks or changing the manifest.
`graph.json`, `manifest.json`, `source.patch` and `untracked-inputs.json` retain
source/build/package/lock/runtime/host identity. Use a fresh output directory.

Build the installed starter with this observer first, then start that exact build with
its ordinary `pnpm start`. To collect its cold/warm private-ordinary journeys without
rebuilding under an already-running server:

```sh
node tooling/benchmarks/react-app-comparison/src/client-delivery.mjs \
  --observe-output tooling/benchmarks/react-app-comparison/results/issue-3884/<fresh-invocation>/starter \
  --capture-url 'http://127.0.0.1:<port>/products/sku-42?preview=true'
```

The retained and served manifest must agree. The generated correctness test also warms
the shell resource, then acknowledges resource operations and native form input while a
real search approval is deferred; it does not introduce a background form/search API.

The example's `tests/client-delivery.spec.ts` attaches CDP and exact DOM observers
before each stimulus. Separate cold/warm and public-prefetch/private-ordinary traces
retain HTML, bootstrap, HTTP-selected initial module, real hydration control acknowledgment,
negotiated payload, built destination module and destination DOM/frame observations.
CDP monotonic seconds and document performance milliseconds are separate clock domains.
`decodedBytes` is the captured decoded body; `encodedTransportBytes` includes protocol
overhead and is **not** the canonical compressed-body budget metric. Cache hits, content
encoding and repeated network transfers remain explicit. A body capture failure, absent
stage or missing provenance cannot be turned into a complete trace.

These unthrottled correctness traces include observation overhead and are not five-run
profile receipts. Keep their complete directories under `results/issue-3884/`, verify
their artifacts with `verifyDeliveryTraceFiles(...)`, and run the unchanged representative
regression gate separately. Do not replace canonical metrics, peer measurements, profile
settings or thresholds with this diagnostic. A client subset pass does not make a failing
server/dev/full verdict pass. Public prefetch remains HTTP-approved and single-use;
ordinary private activation, refresh, retry and history still obtain fresh approval.

## Reproducing evidence

Use the exact frozen-lockfile install, build, browser, measurement, and evaluation
commands recorded in the [suite README](../../tooling/benchmarks/react-app-comparison/README.md).
After those installs and builds, run the deterministic, untimed correctness
and asset/request smoke separately:

```sh
pnpm --dir tooling/benchmarks/react-app-comparison --ignore-workspace test:smoke
```

For repeated measurements, run the README's `run-gate.mjs` command on the
representative host. Its `results/<head-sha>/` directory contains separate
`discovery/` and `regression/` invocations, each with production and development
profile receipts, per-run `traces/`, `dev-traces/`,
`combined-traces/`, and `verdict.json`; retain that entire directory outside
the committed source tree. The initial baseline pins Node.js 24.20.0,
pnpm 10.4.1, Playwright 1.61.1, the seeded dataset, and the macOS arm64
Apple M4 Pro host. Every actual trace additionally records the Chromium
version, source hash, lockfile hashes, app versions, CPU/network emulation,
cache policy, and the dirty-worktree flag. A run interrupted before
`verdict.json` exists is incomplete evidence, even if some profile traces
were written. Do not mix receipts from different source hashes or failed
correctness runs to fill a missing profile.
Keep full raw traces with each report; aggregate ratios without the underlying run
values cannot be independently checked. A committed numeric target is a prospective
budget, not a measured competitor result. Only populate competitor observations from
completed, repeatable measurements; never substitute estimates or one smoke sample.

The first four-profile run on the dirty
`f71be378fc824d6b093a25881ea1f994826c6910` source has SHA-256
`ba68a55a6c04d0d75b640c13373a39b33318d0a892be69437ea935ce1e3e8312`.
Later lint-only source changes passed fresh build/browser checks and changed the
candidate source hash to
`2d52ddcbdfe8699308ea0f1b20f15112b95e2b7e5e0cc09f4658bdc10c391884`;
the discovery is not a performance receipt for that later committed head.
Its [committed manifest](../../tooling/benchmarks/react-app-comparison/evidence/3883-baseline.json)
locates the ignored local `results/local-3883-auth-recheck/` run and records
integrity hashes for 112 production, 112 development, and 80 combined traces
and all receipts. The complete ignored run directory is needed to inspect
individual samples; the manifest alone does not contain their bodies.
The verdict is **fail**: Fluo tablet-native CSS edit median `1504.67 ms`
exceeds its frozen `1500 ms` budget, and 22 relative-band comparisons fail.
Fluo desktop-native compressed JS is `66,373 / 170,000` bytes (pass for
that one metric). The same verdict reports 42 noisy, 64 outlying, and
157 missing-metric checks as inconclusive. `baseline.json` records descriptive
Fluo and competitor medians for all metrics (`null` for unavailable values);
noisy or outlying numeric medians do not turn inconclusive checks into passes.
Neither discovery's exit code nor a numeric median from
an inconclusive check establishes a performance pass.
