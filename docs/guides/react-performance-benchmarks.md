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

### FA-V3 same-execution production acceptance

New production acceptance sets `methodVersion: "FA-V3"`,
`measurementPurpose: "integrated"` and `measurementKind: "production"`.
Use the existing CLI and an explicitly enabled provisioned native observer;
never a separate native counterpart. `evaluateAcceptedEvidence` authenticates the same run's method/config,
product, environment, pair/phase, ordered warmup/measured inventory, raw CPU,
request cutoff and canonical native raw/schema/host receipts before evaluation. Metricless quality failures remain visible.
The existing FA-V2 observed min/max formulas and exact decimal equality apply,
without a new MAD/spread veto, tolerance, budget or sample-selection rule.
FA-V2/unversioned captures retain their historical meaning and cannot be reused.

For each fresh before/final cohort, derive the unchanged representative config,
set a common nonempty `pairId` and explicit `pairPhase: "before"` / `"after"`,
and freeze each full config/source/build/environment identity separately.
Use the explicit isolated Linux representative invocation in the suite README.
Full-suite `run-gate.mjs` also collects fresh development timing with
`measurementKind: "development"`, `measurementPurpose: "timing"` and
`nativeLifetime: { enabled: false }`.
It authenticates kind, purpose, phase and shared tools/source identity before
merging; production terminals/metrics never become dev evidence. RE-A01's
client-owned source-edit authentication remains required, not bypassed.

The canonical agent uses CModule request callbacks for all seven hooks,
independent Resource/Loader births, stable invocation frames and per-thread
parent chains. The 124-byte payload/128-byte stride/512-byte header/500000-event
journal retains native release/acquire publication and all drop/failure/ownership
checks. Source hashes are taken from the actual canonical agent/host/collector,
not private candidates or transformed decoders. Signal entry must precede target
exit/reap; a successful normal sender return may be observed later. Raw NULL,
missing statuses and SIGTERM 15 remain unchanged. Partial hooks/coverage,
missing returns, cutoff drift, foreign evidence or cleanup failure are unavailable
or INCONCLUSIVE, not success. Observer/setup/drain cost is not subtracted.
Default disabled collection requires no Python/Frida; macOS native support is
unsupported. Development/HMR and original browser/readiness/throughput/CPU
boundaries, all budgets, four frameworks/profiles and 2 warmups/5 independent
alternating samples with workload 200/8 remain unchanged.

Provisioned SDK checks live in `tests/native-sdk/`: compile `fixture.c` as
`headless_shell` on Linux ARM64, run `run-fixture.py <fresh-output-root>`
with the pinned Python, then `node verify-fixture.mjs <fresh-output-root>`.
These use the canonical agent and decoder for 65-level nesting, real pthread
interleaving, publication/accounting, pointer reuse, failure and retirement.
The old private 65-level bridge exit-1 finding remains preserved, not made green.
`qualify-browser.mjs <prepared-root>` and its independent `--verify` run
bind the new canonical source closure to the original Next 2-warmup/1-measured
prefix in the prepared guest; preserve all raw artifacts and original exits.
These finite checks prove mechanism qualification, not before/final performance
PASS, issue closure or final-head reviews.
Fresh paired fixed-cycle gates, independent exact-head reviews and GitHub CI
remain later stages.

**Historical method.** The FA-V2 purpose split and commands below are historical.
FA-V3 supersedes only separate production timing/native-conformance acceptance.

### FA-V2 observed-range acceptance

FA-V2 changes acceptance meaning without relaxing numeric budgets or public
behavior. The unchanged `baseline.json` median/spread/MAD vetoes are historical
replay only: `evaluatePerformance(..., "historical-v1")`, `evaluateEvidence`,
CLI `--historical-replay`. Historical FAIL/
INCONCLUSIVE or unversioned receipts cannot be relabeled as FA-V2.

Use all five independent samples without removal. L/U are observed min/max,
B the original budget and b the original band. Compare each of the three peers:

| Comparison | PASS | FAIL |
| --- | --- | --- |
| Upper absolute | U_F <= B | L_F > B |
| Throughput absolute | L_F >= B | U_F < B |
| Upper peer | U_F <= b * L_peer | L_F > b * U_peer |
| Throughput peer | b * L_F >= U_peer | b * U_F < L_peer |

Boundary crossing is INCONCLUSIVE; equality passes, with exact decimal/zero
comparisons and no tolerance widening. Spread/MAD are diagnostics, not
independent vetoes, and cannot hide true budget failures. The old separate
repeatability veto is lost. Five-sample extrema are not confidence intervals,
future-population bounds or statistical guarantees. Missing/invalid/duplicate/
quality/correctness/authentication failures cannot pass. Keep 200 requests/
concurrency 8, five measured/two warmups, alternating order, four frameworks/
four profiles, 22 client/six server metrics and all budgets/bands and peer
cache/prefetch defaults.

Authenticate membership and order against the frozen alternating measurement
plan, including raw `warmup`, `cycle`, `slot`, framework, profile and run ID.
Counts and unique IDs alone cannot distinguish warmups from measured samples.
The approved representative production descriptor binds throughput paths,
journeys/actions and interactions as well as 200/8; identical mutations in every
phase or purpose remain invalid even when their hashes are recomputed.

Derived configs explicitly set `measurement.methodVersion: "FA-V2"` and
`measurement.measurementPurpose: "timing"` or `"native-conformance"`.
Bind the same `measurement.pairId` and `measurement.pairPhase: "before"` or
`"after"` with distinct authenticated config/execution identities. Timing
requires `nativeLifetime: { enabled: false }`; native conformance requires
`{ enabled: true, python: "/absolute/provisioned/python" }`. Purpose is distinct
from cache `native`/`matched-cache` and execution `discovery`/`regression`.
Timing retains CDP/React readiness, passive NetLog authentication, original
cutoff and browser lifetime through throughput/server sampling without Frida.
Native conformance requires original ownership, coverage, journal, retirement,
raw exits and cleanup for the same product/build/stimuli/repetitions. Its
performance values never enter timing verdicts, and terminals cannot be borrowed
across executions. Native conformance alone is not performance PASS.

`evaluateAcceptedEvidence(baseline, timingReceipts, commonOutputRoot,
nativeReceipts)` authenticates both purposes. `evaluateAcceptedPair` additionally
bind fresh before/after phase/pair and frozen method/stimuli/environment.
Retain all raw/config/environment evidence under the common root; runner
`--native-receipts <JSON>` takes an array of matching receipt paths.
Use `--trace-root <common-root>` for sibling purpose roots. Full-suite
`<profile>.json` is the merged production/development receipt. Without
counterparts timing collection reports INCONCLUSIVE; normal gate CLI rejects
unversioned evidence. Method tests do not establish actual pair PASS or issue
closure. Fresh frozen pairs, independent reviews and full GitHub CI remain.

Client adoption preserves the approved RE-A01 source-bound React-edit relation:
before `src/document.ts`/`reload:true` versus after
`src/catalog-destination.tsx`/`reload:false` with unchanged
from/to/path/selector/expectedText and no other field changes. Authenticate and
retain separate full config/source/build/edit-source hashes.
`pairStimuliComparison` identifies the development relation but does not accept
it. The aggregate must invoke the existing client `authenticateReactEditPair`
on both original environment bindings, authenticate source proof and retain
that evidence. Missing verifier/proof fails closed. Server-only production
does not gain this exception. Timing/native counterparts within the same
product require identical actual edit descriptors; the cross-product exception
cannot be borrowed for purpose pairing.
The client verifier authenticates the same FA-V2 method, pair ID and purpose
and only the before-to-after phase transition, retaining original source proof
and relation replay. Production permits that phase transition only, not the dev
edit exception. Preserve
`pairPhase` in each full config/hash and freeze distinct before/after config IDs.

CPU is configured SERVER PID post-workload lifetime average/single logical CPU:
`100 * (utime + stime) / CLK_TCK / (uptimeSeconds - starttime / CLK_TCK)`.
Authenticate/recompute original `/proc/<pid>/stat`, a second birth/counter check,
`/proc/uptime`, `getconf CLK_TCK` and raw `ps`. RSS stays the existing `ps`
snapshot in bytes. No display rounding, client/window CPU or logical-core
division substitutes for this value; the 85% budget remains. Tick/birth
quantization and uptime's 0.01-second resolution remain explicit: unrounded
arithmetic does not guarantee continuous-time precision.

Passive NetLog does not guarantee resolution of missing CDP terminals. Actual
Next RSC without ExtraInfo has shown renderer/native millisecond mismatch and
absent `ResourceFinish` despite complete tracing; same-URL native ownership is
unproved. Keep the existing exact classifier, without a clock window/nearest
URL, guessed cancellation, peer prefetch edit or borrowed native counterpart
terminal. Pending timing remains a quality blocker.
Blink InspectorId/CDP and renderer-generated network request IDs occupy separate
identity spaces. The reviewed Chromium `ResourceLoader::Dispose` GC prefinalizer
can bypass `HandleError`/`DidFailLoading` and detach the URLLoader client. This
source coverage counterexample does not diagnose the actual pending request;
complete tracing is not proof that every terminal callback was instrumented.

The suite's machine-readable `baseline.json` owns the absolute budgets, relative bands,
profiles, run/warmup counts and historical aggregation/noise/outlier policy.
New production acceptance uses FA-V3 above. Preserve
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
Historical Fluo discovery used a build/restart harness, not the canonical
generated starter's development path; those receipts do not establish current
Fluo development latency. The current fixture runs canonical
`fluo dev --runner fluo` through Vite middleware and the gateway. CSS uses
visible HMR, server edits include generation readiness before a fresh document,
and React uses the source-bound before reload/final HMR relation described below.
The TanStack route loader edit restarts its development server before reopening
the changed page and includes that actual restart path. Next.js CSS edits likewise use a server restart
and reopened document after the tablet-class browser failed to observe CSS HMR;
Next.js server edits also restart and reopen after a source update did not
become browser-visible. Neither measurement is a native HMR time.
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

Historical production `nativeLifetime` observation was optional and disabled by default.
FA-V3 production requires same-execution integrated native observation.
The FA-V2 timing/native-conformance split is historical; the observer-specific
requirements below also apply to FA-V3 production integrated observation.
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

Native events buffer in host-retained shared memory without per-event IPC. Hook costs are
not subtracted; setup/drain and separate observer costs are retained in provenance,
not separately measured. Drain follows unchanged throughput and `ps` snapshots,
before BrowserServer close, while preserving the original request cutoff.
Each owned session retains its Frida agent and child gating until natural
process exit. Observer hooks stop at drain without changing a resuming exec
child's gate. Final close cleans remaining sessions, while session detach/unload
follows process exit rather than preceding BrowserServer close.
An eternalized inert script prevents live-agent unload if failed/aborted
preparation forces bounded observer-child termination.
Resident memory/runtime overhead remains included without subtraction. The
Transport schema v2 retains an append-only memfd journal per
PID/starttime/exec epoch, owned and verified by the host before hooks readiness
or gated resume. Its 500000 fixed-width records never wrap. The native writer
uses AArch64 release publication and the host uses acquire reads; raw binary
headers/records, ownership, attempted/committed counts, sequence markers, drops
and native callback/invocation state are authenticated and replayed. Missing
ownership, interrupted publication/callbacks, overflow and incomplete calls
remain inconclusive even after hashes are recomputed.

A live interval must cover the original cutoff. Earlier retirement instead
requires authenticated detach and birth-bound normal status, without RPC to a
destroyed script or artificial cutoff padding. A separate early browser
lifecycle zombie-status witness does not replace missing pidfd status or assign
causality to a signal sent to a zombie.
If no such status witness exists, the authenticated owned browser/zygote
parent's actual `waitpid`/`wait4` normal return supplies only its genuine raw
reap status, with pre-call kernel PID/starttime/parent, original stat, return PID
and observer sequence.
NULL wait destinations remain NULL. A separate birth-bound zombie `stat`
exit-code field captured before the actual reap may supply status; neither
the wait result nor pidfd status is rewritten. Earlier raw SIGTERM 15 additionally
requires its own complete pre-cutoff Chromium normal termination caller/return chain and
successful live-target send. It is never rewritten to zero; missing pidfd
status stays missing. This retirement proof does not borrow/backdate
`graceful-close` and remains separate from post-close shutdown authentication.
Successful gated exec keeps distinct
histories and verifies successor readiness before resume; failed exec does not
close an epoch. Unknown roles/status, crashes and unsupported transitions are
rejected. Production COOP navigation and capture boundaries remain unchanged.
The separate two-document nonempty-retirement correctness fixture is never
pre-navigation in a measured cohort. Journal, writer/callback and lifecycle
overhead remain included; these correctness checks are not performance PASS.

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
returns, script/transport errors, unproven renderer retirement, identity ambiguity,
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
identical actual tools/resources and frozen settings except the authenticated
two-field React-edit alternative below, and schedule exclusive timing windows.
Passive generator CPU and ambient contention snapshots use existing timing
windows without changing CPU/RSS, capture or throughput boundaries or budgets.
Historical `baseline.json` stays untouched, including macOS Node `24.20.0`;
do not report a gain by comparing old macOS and new Linux observations.
Tracked representative defaults do not enable Frida. Ordinary default/CI/macOS
paths need no Docker/Python/Frida, and this local mode claims no cross-platform
performance acceptance.
Comparable identity excludes invocation locators and product commit/build
differences: actual absolute paths/config stay in evidence and provenance, while
tool/collector content hashes and allocation must match even when worktree/build
roots differ. Every invocation retains its full exact configuration and hash.

The sole unequal-config dev alternative is before product
`8a09eb8d216e555b97760a86539dea31e79c86a8` using Fluo `src/document.ts` /
`reload:true`, and reviewed final `f9f5ac6722957cbe2752b9959e657a46594c0a1b`
or its source-verified implementation descendant using
`src/catalog-destination.tsx` / `reload:false`. Apart from the authenticated
versioned before-to-after phase transition, only those two fields may differ;
all other settings, edits, peers and budgets remain identical. Both replace
`Editor login` once with `Editor login changed` on `/login`, observe the same
visible `h1`, and restore exact source bytes. Original representative full hashes
remain distinct: before `b7e8cfc2c53a57006197357542b6831b9ccb58835297ee01e22a7a1afc5a5b5d`,
final `a48953e1f5825e26afc5865a5177af988619bdceebec801cf8b4025b1a2fad73`.
Use `--environment-before-record` and `--environment-before-root` with both original
identity flags; original bytes/digests, containment, invocation, source/head/blob,
build/dependency and collector evidence authenticate the relation in capture and
replay. Production-only pairs permit only the authenticated versioned phase transition,
with all other config fields identical; profile,
dev and warmup hashes remain separate from the aggregate.
Prepare the before record with `--react-edit-pair-source`; aggregate and
development captures retain its proof, while production-only children do not
inherit this flag. A different authenticated edit descriptor makes source proof
mandatory for after. Ordinary isolated captures and same-config pairs without
the opt-in retain their existing path without pinned ancestry/blob or dev-only
production-build requirements.

Pre-stimulus observers distinguish new main-frame document `reload-to-visible`
before from correlated same-document component `hmr-to-visible` final.
Fallback/restart/relaunch is recorded as observed and cannot substitute for
selected HMR evidence. Initial/final visible markers and original/edited/restored
bytes/hashes remain in raw evidence. The lead selected product-native paths on
best judgment after an unanswered question, not an affirmative user choice or waiver.
Merge base `942f673d34d58a9093d7012253913aec9143ff45` and final upstream
`f3e699047bfa51bbb69d9abeb2717eeb9e1871b0` include CLI/HTTP/React typegen,
background-form, navigation, store and provider changes; product-level differences
are not solely #3884's causal effect or a same-upstream single-optimization control.
Narrow pair checks do not establish performance PASS. Full four-framework/
four-profile fresh recollection, two warmups/five alternating samples, unchanged
budgets and versioned FA-V3 decisions, exact-head reviews and final GitHub CI remain required.

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
