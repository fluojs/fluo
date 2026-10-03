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

For #3885, [the suite's server-only runner](../../tooling/benchmarks/react-app-comparison/README.md)
retains the four profiles and their frozen repetition/noise rules but assesses
only production server TTFB, throughput/error rate, CPU and RSS. It does not
run development edits or claim a complete 22-metric verdict. Its browser
first-contentful-paint remains `shellArrivalMs`, **not** the socket's
first received shell byte. A separately gated actual Fastify socket tests
shell delivery and request-abort cleanup; a paused client tests
`write(false)`/drain-or-close and request-scope disposal. A gzip proxy that
flushes incrementally can deliver a decoded shell before the descendant
resolves, while a proxy that collects the full body before gzip buffers it.
Buffered hosts are measured independently at declared body sizes and
concurrency. Node's writable high-water mark cannot cap total RSS.

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

## Reproducing evidence

### Explicit Linux server-only environment

The historical macOS ARM64 Apple M4 Pro/Node 24.20.0 baseline is unchanged.
The current representative GitHub workflow still requires
`self-hosted, macOS, ARM64, react-app-performance-m4-pro` labels and does not
dispatch the new Linux path. Ordinary CI/macOS uses the default disabled native
lifetime observer without requiring Docker, Python or Frida.

#3885 explicitly selects an actual running Linux ARM64 container on the same
Apple M4 Pro host. The frozen environment is OrbStack kernel
`7.0.14-orbstack-00380-ga7e0a2dc9535`, image reference
`fluo-verification:sha256-81a185cd17d652f2d9fe7dbbaad1647262d17094e49eac533e7de30d2b37293e`,
actual image ID
`sha256:f240abbe0c9fadb08df3b4f8b409111f5fd87733dfade0c69d6dfd839682d56b`,
Node `v24.21.0`/V8 `13.6.233.17-node.53`, 12 logical CPUs and
8,392,974,336 bytes of shared VM memory. There is no additional per-container
CPU quota, cpuset or memory limit. This is observed shared capacity, not a
dedicated reservation. The lead selected it by best judgment after the user
question expired unanswered, not affirmative user selection or a budget waiver.

Coordinate an exclusive timing window and prepare dependencies and production
builds in that environment first. The container must see the checkout at the
same absolute path and use its actual provisioned SDK and browser.
[The suite README's actual command](../../tooling/benchmarks/react-app-comparison/README.md#explicit-linux-server-only-invocation)
derives a local config from the unchanged `config/representative.json`, explicitly
sets `measurement.nativeLifetime = { enabled: true, python: "/absolute/provisioned/python" }`,
then uses this runner:

```sh
node src/run-server-only.mjs \
  --config ../../../.omo/verification/issue-3885/server-environment-config.json \
  --output-dir "$(pwd)/results/$(git rev-parse HEAD)/before" \
  --isolated-container <running-container>
```

Host Docker info/inspect selects the running container and transports a fresh
invocation. The guest authenticates OS/kernel, image/allocation, actual Node/pnpm
executables, Playwright/TypeScript SDK implementations, the launched browser,
Python/Frida executable/dependency hashes, collector/observer/schema and cgroup
allocation. SDK provisioning after image creation is verified separately from
the image ID. Preparation JSON does not replace the live invocation.
Missing/mismatched/tampered/unsupported bindings cannot pass collection or server
evaluation.

`chromium-native-lifetime-v1` is opt-in. Support is limited to Linux ARM64
revision 1228 `headless_shell` `149.0.7827.0`, binary SHA-256
`b6f53f7e40c3ad6727cb3a12536026dcd93281e5965923752c8130ed53e5e8c4`,
build ID `afcd146a627911fb30269f995d093903636ed886`, ELF64-LE-AArch64,
Python `3.11.2`/Frida `17.21.0` frozen hashes and versioned hook/agent/host schema.
Requested observation on an unsupported host, including macOS, remains
unavailable/nonzero/inconclusive rather than falling back to a native PASS.

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

The common production observer drains/stops request hooks at the original cutoff
but retains child gating, Frida sessions/agents and pidfd exit subscriptions
through natural owned-process exit. Release does not change a resuming exec
child's gate; final close cleans up any remaining sessions. Live-agent detach/unload does
not precede BrowserServer close. An eternalized inert script prevents live-agent
unload if failed/aborted preparation forces bounded observer-child termination.
Resident memory/runtime and post-drain shutdown IPC costs are not subtracted.
Main exit/error/disconnect and available descendant wait statuses remain raw
evidence; known abnormal exits are rejected before NetLog parsing. Reaped statuses
stay missing, not zero; Python exit 0 or main exit 0 does not prove every
descendant exited normally. For post-close shutdown, raw status 15 is classified as intentional only when
the authenticated Chromium normal-shutdown caller, live owned target PID/start
identity, successful SIGTERM send, explicit-close ordering and normal main exit
all agree. Zombie targets, failed sends, missing callers and unknown causes are
not admitted; status 15 and missing statuses are never rewritten to zero.

Runner provenance, profile receipts, production/warmup raw traces and separate
socket observations retain the same actual environment binding.
`evaluateServerEvidence` invokes common environment and raw/native trace
authentication before filtering the original evaluator to the six server
metrics. Passive headroom adds generator/ambient CPU observations without
changing original sampling, browser cutoff, throughput or subsequent `ps`
CPU/RSS sampling and lifecycle. Sockets remain native loopback, without browser
profile emulation; buffered size/concurrency evidence stays an independent
experiment.

For after, pass **both** `--environment-identity <identitySha256>` and
`--environment-config-identity <configSha256>` from the before runner's
top-level `server-verdict.json.environmentBinding`. Comparison excludes run IDs/PIDs, absolute
product/tool locators and product HEAD changes while retaining their provenance;
actual tool/collector content, allocation and frozen config are not excluded.
Keep the entire environment record, profile config, receipt, raw/native traces,
socket files and verdict together for replay. Do not pair historical macOS with
new Linux gains or reclassify historical Linux FAIL/inconclusive results.
Fresh before/after recollection with the same final collector is still required;
an environment probe is not performance acceptance.
Stable product/source/build provenance is separate from authenticated top-level
invocation bindings. Runner and measurement child both select the same
`entrypoints: ["run-server-only.mjs"]` common capture boundary: 12 common sources
plus the runner, server measurement and socket-shell sources. The child receives
the selection and parent binding over invocation transport and authenticates/
compares the actual environment before driver work. Strict `gate.mjs` is unchanged.
Explicit isolated mode forwards host SIGINT/SIGTERM through an invocation-owned
Linux Python subreaper, requires descendant reaping and rechecks allocation in
`finally`; ordinary disabled CI/macOS gains no Python requirement.

The earlier common-environment four-warmup probe retained a truncated NetLog and
incomplete coverage after browser closure; its cause is unresolved. A later
DEBUG/zero-warmup small-fixture pass does not prove warmup stability. Preserve
failures as nonzero/inconclusive without JSON repair, sleep/poll flushing or
reducing frozen acceptance warmups.
An independent source-pinned reproduction observed main-browser SIGSEGV after
Frida detach and before `server.close`, with the actual network-service writer
closed without a JSON footer. Delayed flushing does not explain that reproduction.
Resident-agent diagnostic rows are not a production fix or stability proof.
A separate zygote crash occurred despite complete JSON and main exit 0; neither
proves safe descendant teardown. The original historical capture lacked browser
exit evidence, so do not assign the reproduced cause retroactively or reuse
diagnostic results as performance acceptance.
The subsequent common production correction adopts the resident teardown boundary
and authenticated shutdown observation together. Bounded fixture/replay success
on new source does not erase historical failures or substitute for full paired
performance acceptance, long-lived stability or independent reviewer PASS.

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
