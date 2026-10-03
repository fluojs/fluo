# Isolated React application comparison

This suite is a scoped exception to the [existing local-only internal and HTTP
benchmarks](../README.md). It compares Fluo with pinned Next.js App Router, React Router
Framework Mode, and TanStack Start builds on the same seeded public listing/detail,
authenticated CRUD, and shell-preserving jukebox journey. The
[EN](../../../docs/guides/react-performance-benchmarks.md) and
[KO](../../../docs/guides/react-performance-benchmarks.ko.md) guides explain what
these comparisons can and cannot establish. This suite does not claim that the
current Fluo reference example already implements the complete product contract.

## Reproduction boundary

Install with this suite's isolated `pnpm-lock.yaml`; do not resolve framework versions
from the root workspace or update the lockfile during a timed run. Build linked Fluo
packages from the selected source commit, then build each application using its native
production command. Capture `git rev-parse HEAD`, `git status --short`, the lockfile
SHA-256, exact Node/pnpm/framework/browser versions, commands and exit codes with
every run. An uncommitted worktree is a different build input; retain its patch. Never
use data from a failed correctness journey or a failed production build as timing
evidence.

Production server children run with `NODE_ENV=production` identically for all
four frozen apps; provenance records `environment.serverNodeEnv`. A production
bundle alone does not select the production external React server renderer.
Earlier runs that inherited an unset/development environment remain archived
and do not establish a matched production comparison. Recollect both sides
with the same production environment. The seeded workload, peer versions,
prefetch defaults, repetitions, budgets and all metric definitions remain
unchanged, including post-workload `ps` CPU/RSS snapshots. Development runners
remain separate from this production startup helper.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --dir tooling/benchmarks/react-app-comparison --ignore-workspace install --frozen-lockfile
for app in fluo next react-router tanstack-start; do
  pnpm --dir "tooling/benchmarks/react-app-comparison/apps/$app" --ignore-workspace install --frozen-lockfile
done
pnpm --dir tooling/benchmarks/react-app-comparison --ignore-workspace build
pnpm --dir tooling/benchmarks/react-app-comparison --ignore-workspace typecheck
pnpm --dir tooling/benchmarks/react-app-comparison --ignore-workspace test:smoke
node tooling/benchmarks/react-app-comparison/src/run-gate.mjs \
  --config tooling/benchmarks/react-app-comparison/config/representative.json \
  --output-dir tooling/benchmarks/react-app-comparison/results/<head-sha> \
  --mode discovery
```

`--mode discovery` records the first honest measurement before optimization. Its
`verdict.json` still contains the actual `fail` or `inconclusive` performance
verdict; exit status zero means only that the four-app correctness runs completed
and raw traces were retained. Omit the flag for the representative regression
gate: a `fail` or `inconclusive` verdict then exits nonzero. Never use discovery
mode in the representative CI workflow or describe discovery's exit status as
a performance PASS.
Keep each invocation in a fresh `results/<head-sha>/discovery/` or
`results/<head-sha>/regression/` directory. The gate rejects nonempty output
directories so a failed retry cannot reuse an older receipt.

For #3885's **server-only before/after assessment**, coordinate an exclusive
representative-host window first, then use the same frozen builds and four
production apps with `node src/run-server-only.mjs --output-dir
results/$(git rev-parse HEAD)/before` (or `after` on the verified new head).
This runs the existing seeded production journeys with the frozen four profiles,
two warmups, five independent runs per app and alternating order, but **does
not run development edits or use client metrics in its decision**. `server-verdict.json`
filters the unchanged evaluator to cold/warm TTFB, throughput, error rate,
CPU, and RSS; all raw production observations, quality failures, exact browser
version and environment remain in per-run `traces/`. Its verdict applies only
to this server subset, not the 22-metric product gate. Browser
`shellArrivalMs` is first-contentful-paint, so a separately gated direct
HTTP socket proves shell delivery rather than silently renaming that metric.
Each profile also records two warmups and five direct Node loopback socket
samples of the same built Fluo public listing in `<profile>-socket.json`:
first body byte and identifiable shell marker are measured independently.
These socket samples do **not** inherit the browser's tablet CPU/network
emulation and have no invented numeric SLA.
The runner fingerprints tracked and untracked source inputs, the isolated and
root lockfiles, the four app build trees and directly linked Fluo build trees.
It emits per-slot correctness/measurement and completed-trace events so an
interrupted profile can be located without treating partial traces as a receipt.
SIGINT/SIGTERM cancels the pending measurement and reaps all owned server
groups before writing a nonpassing verdict. A 15-minute per-profile execution
deadline aborts a stalled measurement; it is an operational runner deadline,
not a new performance or slow-client SLA. A forced coordinator/runner SIGKILL
cannot execute JavaScript cleanup: inspect and reap any proven owned detached
groups before another run. A dirty-source fingerprint never proves an untouched
historical baseline or a later committed head.
For short coordinated windows, append `--profile desktop-native` (or another
frozen profile name) and use a fresh profile-specific output root. This preserves
the full two-warmup/five-run alternating workload for that profile. The verdict
still evaluates the unchanged four-profile baseline: a single-profile receipt
cannot pass the server subset. Aggregate only complete profile receipts whose
source, build and lockfile fingerprints match, retaining each original root
and checking all raw trace paths under the common exact-head result root.
`src/buffered-memory.mjs` separately probes buffered body sizes/concurrency
under the same exclusive window: pass `--body-bytes`, `--concurrency` and
`--output results/<head-sha>/<window>/<case>.json`. The reported RSS and
array-buffer peaks are process observations, not an adapter output limit;
the chunk-plus-result value describes the temporary two-copy collection
mechanism, not a measured whole-process ceiling.

The PR workflow runs `test:smoke` for suite changes after the isolated frozen install
and a root build within the existing 16-task catalog's conditional `static` task;
HTTP comparison retains its separate `isolated-benchmark` selector. It is a correctness and deterministic size/request-count gate, not
one noisy shared-runner performance sample. A separate representative-environment
workflow runs repeated profile measurements. A genuine failed measurement must remain
a failed gate; unknown or noisy data has an inconclusive verdict, never `pass`.
The representative workflow requires a provisioned `self-hosted, macOS, ARM64,
react-app-performance-m4-pro` runner. Without that runner, its GitHub dispatch
cannot be claimed as executed; local results must identify the actual host.
The runner starts built production servers with exact ready events, keeps raw
trace files under the supplied `results/` directory, then combines all four
profile receipts through `src/gate.mjs`. A single profile is not a gate pass.

## Frozen decision policy

### Explicit Linux server-only invocation

The historical macOS ARM64 Apple M4 Pro baseline, including Node 24.20.0,
remains unchanged. The existing representative GitHub workflow still requires
`self-hosted, macOS, ARM64, react-app-performance-m4-pro`; it does not dispatch
this Linux path. Ordinary CI/macOS invocations keep the default disabled native
lifetime observer and do not require Docker, Python or Frida.

#3885's new representative path explicitly selects a running Linux ARM64
container on the same Apple M4 Pro host: OrbStack kernel
`7.0.14-orbstack-00380-ga7e0a2dc9535`, image reference
`fluo-verification:sha256-81a185cd17d652f2d9fe7dbbaad1647262d17094e49eac533e7de30d2b37293e`,
actual image ID
`sha256:f240abbe0c9fadb08df3b4f8b409111f5fd87733dfade0c69d6dfd839682d56b`,
Node `v24.21.0`/V8 `13.6.233.17-node.53`, 12 logical CPUs and
8,392,974,336 bytes of shared VM memory, without an additional per-container
CPU quota, cpuset or memory limit. These are observed shared capacity, not a
dedicated reservation. Coordinate an exclusive timing window before invoking it.
The environment choice was lead best judgment after an unanswered question,
not an affirmative user selection or a budget waiver.

Prepare the dependencies and production builds separately in that environment.
The selected container must see the checkout at the same absolute path, with
the actual provisioned SDK and browser available to that checkout. Derive a
local config from the unchanged tracked defaults, explicitly enabling the
observer with the provisioned absolute Python path:

```sh
# From the suite directory; replace the Python locator with the actual provisioned path.
node --input-type=module -e '
import { mkdir, readFile, writeFile } from "node:fs/promises";
const config = JSON.parse(await readFile("config/representative.json", "utf8"));
config.measurement.nativeLifetime = { enabled: true, python: process.argv[1] };
await mkdir("../../../.omo/verification/issue-3885", { recursive: true });
await writeFile("../../../.omo/verification/issue-3885/server-environment-config.json",
  JSON.stringify(config, null, 2) + "\n");
' /absolute/provisioned/python
node src/run-server-only.mjs \
  --config ../../../.omo/verification/issue-3885/server-environment-config.json \
  --output-dir "$(pwd)/results/$(git rev-parse HEAD)/before" \
  --isolated-container <running-container>
```

The host launcher observes actual Docker info/inspect, selects that running
container and transports a fresh invocation to its Node executable. The guest
authenticates OS/kernel, image/allocation, Node and pnpm executables,
Playwright/TypeScript SDK implementations, the actually launched browser,
Python/Frida executable/dependency hashes, collector/observer bytes and cgroup
allocation. Provisioning after image creation is authenticated separately from
the image ID. An environment JSON supplied as preparation metadata is not a
live invocation. Missing, mismatched, unsupported or tampered bindings cannot
pass collection or server evaluation.

`chromium-native-lifetime-v1` is opt-in, supported only for Linux ARM64
revision 1228 `headless_shell` `149.0.7827.0`, binary SHA-256
`b6f53f7e40c3ad6727cb3a12536026dcd93281e5965923752c8130ed53e5e8c4`,
build ID `afcd146a627911fb30269f995d093903636ed886`, ELF64-LE-AArch64,
Python `3.11.2` and Frida `17.21.0` with the frozen runtime hashes and
versioned hook/agent/host schema. An unsupported host, including macOS for this
native observer, is unavailable/nonzero/inconclusive when requested; it is
not a fallback native PASS.

Transport schema v2 retains an append-only memfd journal for each
PID/starttime/exec epoch. The host acquires and verifies its descriptor before
acknowledging hooks readiness or gated resume. The 500000 fixed-width records
never wrap: the native writer publishes each payload with AArch64 release
ordering, and the host reads markers with acquire ordering. Attempted/committed
counts, sequence markers, drops, native callback and invocation counts, ownership
and the original binary header/records remain in hashed raw evidence. Missing
ownership, an interrupted publication/callback, overflow or an incomplete call
cannot become complete by recomputing hashes.

Retired images are read from the retained mapping, without RPC to a destroyed
script. A live interval must cover the original cutoff; an earlier retired
interval requires authenticated detach plus a birth-bound normal status.
The early browser lifecycle observer may retain a separate zombie `/proc` status
witness; it never replaces a missing pidfd status or treats a signal to a zombie
as its cause.
When that witness is unavailable, only the authenticated owned browser/zygote
parent's actual `waitpid`/`wait4` normal return can supply an independent raw
reap status. Its pre-call kernel PID/starttime/parent, original stat, return PID,
status and observer sequence are retained. A NULL wait
status destination remains NULL; a separate birth-bound zombie `stat` exit-code
field captured before the actual reap may supply status, without rewriting
either the wait result or pidfd status. Raw SIGTERM 15 is admitted for an
earlier retirement only with its own complete pre-cutoff Chromium normal
termination caller/return chain and successful live-target send. It stays 15;
missing pidfd status stays missing. This proof does not borrow or backdate
`graceful-close` and is separate from the existing post-close shutdown proof.
Successful gated exec retains distinct old/new histories and
requires successor readiness before resume; failed exec cannot close the old
epoch. Unknown roles/status, crashes and unproved transitions stay inconclusive.
Neither the production COOP first navigation nor the capture boundary changes.
Nonempty retirement is also checked in a separately labeled two-document
correctness fixture, never a preliminary navigation in a measured cohort.
Journal mappings, native writer/callback accounting and lifecycle observation
costs remain included. Correctness evidence is not a paired performance verdict.

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

Retain `provenance.json`, each `environment-<invocation>.json`, profile configs,
receipts, production/warmup raw traces, native artifacts, socket observations
and `server-verdict.json` together. Runner and profile receipts bind the same
actual environment identity; socket samples retain the runner binding and
passive headroom alongside their separate loopback semantics. Production raw
traces retain passive generator/ambient CPU headroom without changing the
original browser cutoff, throughput, post-throughput `ps` CPU/RSS sampling
or lifecycle. Buffered body-size/concurrency evidence remains a separate
experiment, not a seventh server metric.

For the final-runtime `after`, pass **both** comparison IDs from the `before`
runner's top-level `server-verdict.json.environmentBinding`:

```sh
node src/run-server-only.mjs \
  --config ../../../.omo/verification/issue-3885/server-environment-config.json \
  --output-dir "$(pwd)/results/$(git rev-parse HEAD)/after" \
  --isolated-container <running-container> \
  --environment-identity <before-identitySha256> \
  --environment-config-identity <before-configSha256>
```

Comparison excludes invocation IDs, PIDs, absolute product/tool locators and
product HEAD changes, while retaining them in provenance. Tool/collector
content, resource allocation and frozen configuration remain comparable
identities. Replay calls `evaluateServerEvidence(baseline, receipts, outputRoot)`,
which authenticates aggregate environment bindings and complete raw/native
traces before filtering the unchanged evaluator to the six server metrics.
Do not pair a historical macOS observation with a Linux gain or relabel the
historical Linux FAIL/inconclusive results. Fresh before/after recollection
on the same integrated collector is still required; an environment probe
is not performance acceptance.
Product/source/build provenance stays stable and separate from authenticated
top-level invocation bindings. Both runner and measurement child select
`entrypoints: ["run-server-only.mjs"]` through the common capture API. The child
receives that selection and the parent binding over its finite invocation
transport, authenticates it and compares the actual 15-source environment
identity before driver work. The shared capture/replay/live checks cover the
12 common sources plus `run-server-only.mjs`, `server-measurement.mjs` and
`socket-shell.mjs`; strict `gate.mjs` provenance comparison is unchanged.
The isolated host launcher forwards SIGINT/SIGTERM through an invocation-owned
Linux Python subreaper, requires complete descendant reaping and rechecks the
host allocation in `finally`. This additional Python requirement belongs only
to explicit isolated Linux mode, not the ordinary disabled path.

The earlier common-environment four-warmup probe retained a truncated NetLog
and incomplete coverage after browser closure. Its cause remains unresolved;
a later DEBUG zero-warmup small-fixture pass does not establish warmup
stability. Keep such failures nonzero/inconclusive, without JSON repair,
sleep/poll flushing or reducing the frozen acceptance warmups.
An independent source-pinned reproduction later observed main-browser SIGSEGV
after Frida detach and before `server.close`; its actual network-service writer
closed without a JSON footer. Delayed flushing does not explain that reproduction.
Resident-agent diagnostic interventions completed their bounded rows, but are
not a production fix or stability proof. A separate zygote crash also occurred
with complete JSON and main exit 0, so neither proves safe descendant teardown.
The original historical capture lacked browser exit evidence; do not assign
the reproduced cause retroactively or reuse diagnostic results as acceptance.
The subsequent common production correction adopts the resident teardown boundary
and authenticated shutdown observation together. Bounded fixture/replay success
on new source does not erase historical failures or substitute for full paired
performance acceptance, long-lived stability or independent reviewer PASS.

[`baseline.json`](./baseline.json) fixes prospective numeric absolute budgets and
per-competitor relative bands for all 22 mandatory metrics on four named profiles:
desktop and emulated tablet-class CPU/network, each with native/default caching and
a matched-cache-policy run. It requires five independent runs per framework/profile,
two warmups per run, alternating target order, median of per-run percentiles, and a
15% across-run spread bound. A sample more than three median absolute deviations
and 15% of the median from center is inconclusive, not silently discarded. `errorRate`
must be zero. Higher throughput is better; other budgets are upper bounds. Do not
relax a budget without a separate explicit reviewed baseline change.

The initial discovery is recorded as `measured-fail` in `baseline.json`. Its
`fluoObservations` and `competitorObservations` contain the measured per-profile
medians for all 22 metrics; `null` denotes an unavailable observation, not zero.
A numeric median from noisy or outlying samples is descriptive, **not** a passing
check. Per-check reasons remain in the ignored local
`results/local-3883-auth-recheck/verdict.json`, indexed by the
[run manifest](./evidence/3883-baseline.json). The budget numbers are
**targets set before optimization**; the separate observations are measured.
Missing data, absent traces, failed correctness, insufficient repetitions, and
noisy runs cannot pass the evaluator.
The approved interaction marker belongs to the rendered destination rather than
the pending route location. Document replacement and response-body capture errors
mark the run inconclusive; failed browser requests remain in `errorRate` alongside
throughput failures. Failed correctness subprocesses retain their receipts and
still produce a combined verdict when the raw traces are complete. Owned process
groups emit `BENCH_PROCESS_REAPED` only after a liveness probe, escalating to
SIGKILL if SIGTERM leaves descendants alive.
Development cold start and React/CSS/server edit-to-visible are distinct timed
experiments; they must not be synthesized from production timings. Record native
cache controls separately and never set identity-dependent data to `public`.

The mandatory metrics are cold/warm TTFB, shell arrival, LCP, hydration/main-thread
work, interaction-to-pending and approved-view p50/p95, transferred and compressed
JS/CSS, request count, throughput, error rate, CPU, RSS, dev cold ready, and
React/CSS/server edit-to-visible. Capture RSC and hydrated-model differences,
client work/bytes, server process CPU/RSS, generator saturation and contention,
environment and asset/request inventories. An emulation profile does not establish
results for an untested physical device.

The first four-profile discovery completed on the recorded dirty
`f71be378fc824d6b093a25881ea1f994826c6910` worktree with source SHA-256
`ba68a55a6c04d0d75b640c13373a39b33318d0a892be69437ea935ce1e3e8312`.
Subsequent lint-only changes moved the React provider's child to the canonical
`createElement` argument and used template literals for trace newlines.
The candidate source hash is
`2d52ddcbdfe8699308ea0f1b20f15112b95e2b7e5e0cc09f4658bdc10c391884`;
its build and browser smoke passed, but these discovery traces are **not** a
performance receipt for the later committed head.
The performance verdict is **fail**: Fluo tablet-native CSS edit median
`1504.67 ms` exceeded its unchanged `1500 ms` budget, and 22 relative-band
checks failed. There are also 42 noisy, 64 outlying, and 157 missing-metric
checks; none was changed to pass. Fluo desktop-native compressed JavaScript
was `66,373` bytes against a `170,000` byte budget, a pass for that metric only.
The manifest fingerprints 112 production, 112 development, and 80 combined
raw traces, plus every config, receipt, and verdict file. The bulk `results/`
directory is deliberately gitignored: a checkout of this commit contains the
manifest, **not** the underlying raw files. Keep or transfer the complete local
run directory to reproduce the observation. From this suite directory, verify
each manifest `sha256OfSortedShasumLines` with:

```sh
find results/local-3883-auth-recheck/traces -type f -name '*.json' -print0 |
  xargs -0 shasum -a 256 | LC_ALL=C sort | shasum -a 256
```

Substitute `dev-traces` or `combined-traces` for the other directories;
individual root-file SHA-256 hashes are listed under `receipts`. The committed
manifest is an integrity index and provenance pointer, not a substitute for
the ignored raw files or a claim that a GitHub artifact was uploaded.
The desktop browser viewport is 1440 × 900; the emulated tablet viewport is
820 × 1180 with 4× CPU slowdown and 1.6 Mbps downlink. The viewport and
network settings appear in each raw trace, not only in a profile label.
`shellArrivalMs` uses browser first-contentful-paint, and
`hydrationMainThreadMs` is the initial-navigation CDP `Performance.TaskDuration`
in milliseconds; it includes work outside hydration and is not an RSC byte count.
The shared `react-initial-completion-v1` boundary replaces load-only cold sampling.
Before entry navigation, the collector installs a React DevTools observer (forwarding
an existing hook) and CDP request observers. It requires document load and an actual
root with `isDehydrated=false` and an element, no pending root lanes, and no fallback
or dehydrated Suspense in the committed Fiber tree. A commit with the frozen passive
mask `10256` must pass `onPostCommitFiberRoot`; a subsequent commit with no passive
work can complete directly. This observes synchronous passive effects and their
scheduled React updates, not just the first root commit. Existing
`data-benchmark-hydrated` leaf-effect markers must also be true. Cold-owned document,
script and stylesheet request identities must settle successfully before cold CPU,
asset/request inventory sampling and the warm trigger. This is not a DOM-presence,
sleep or network-idle heuristic.

Support is limited to the frozen production renderers `19.2.8` and Next's bundled
`19.3.0-canary-cbb046ab-20260731`, whose commit/passive hooks and Fiber fields were
checked. Timeout, absent observer, unsupported renderer or failed initial resource
throws, producing a nonzero/inconclusive run rather than load-only fallback.
This does not guarantee completion of arbitrary asynchronous effect work,
future roots, or background prefetch. Next's native RSC prefetch is unchanged;
pending/aborted RSC remains separately recorded and can still make the run
inconclusive or fail its error budget. `timings.initialBoundary` retains renderer
versions, commit/post-passive states, load/completion/sample/warm timestamps, raw CDP
metrics/paint entries, initial requests and pending-at-warm identities; request
records retain loader/request IDs, initiators, settlement phase, timestamps and
cancellation. Existing raw-trace authentication remains mandatory.

Historical load-only data sampled a different initial-work window and could start
warm navigation while cold-owned modules were unfinished; retained Linux evidence
includes canceled cold scripts. Preserve all prior fail/inconclusive results.
Recollect unchanged-runtime before and final-runtime after with the **same corrected
collector** before comparing them. All 22 metric names/scopes, budgets, five runs,
two warmups, alternating order, uncertainty rules and peer defaults remain unchanged.
Four-app readiness smoke establishes correctness, not a performance PASS.
The framework-neutral `chromium-netlog-cancellation-v1` observer starts a
separately owned Chromium capture for each production measurement, before any
page action. The context/cache/emulation settings and workload remain unchanged.
It records complete native NetLog `Everything` and the original CDP network/frame
ledger in a unique `native-terminal-*` directory inside the raw trace directory.
The final capture uses CDP `Performance.Timestamp` on Chromium's monotonic clock;
browser teardown flushes the NetLog once. Teardown terminals at or after that
cutoff cannot become measured outcomes.

A pending CDP identity gains a native cancellation outcome only with exact
URL/method and the same truncated millisecond network request tick, a unique mapping in
both directions, one `URL_REQUEST` source identity including `start_time`,
`REQUEST_ALIVE BEGIN`, reciprocal native HTTP stream controller (or allocated
job) bindings, `CANCELLED`,
and `REQUEST_ALIVE END` in source/time order before capture. A unique retained
`requestWillBeSentExtraInfo.connectTiming.requestTime` supplies the native clock;
renderer dispatch may precede it across a millisecond boundary. Duplicate,
invalid or contradictory ExtraInfo remains inconclusive. Without ExtraInfo,
the exact renderer tick is used; no nearest-time window is introduced. Other clock
precision, ambiguous/redirected sources, missing bindings or terminals remain
inconclusive. Original CDP pending snapshots stay in `cdpObservation` and the
append-only ledger; native event indices, source identities, times, contained
raw paths and SHA-256 hashes accompany the separate `nativeTerminal`.
This is not a synthesized `Network.loadingFailed` or a success/error-code guess.
Actual native cancellation counts as failure under the existing `errorRate`.
The capture's original CDP pending IDs remain separately available.

Passive logging adds disk, CPU and memory overhead, and per-measurement browser
launch/close adds untimed setup/cleanup work. Record the exact browser version
and this method in every cohort. Recollect both baseline and final with this
same method; do not retrofit historical evidence or infer producer closure.
NetLogs can contain headers and payload bytes; retain the complete scoped raw
files as local evidence. Raw-trace authentication checks containment, complete
JSON and both native/CDP digests before accepting a receipt. Browser teardown
and native parsing occur after the unchanged throughput and post-workload
CPU/RSS sampling; the earlier browser-request cutoff still excludes all
later native terminals.
The `transferred*Bytes` asset budgets use decoded CDP `Network.dataReceived`
byte counts; `compressed*Bytes` uses encoded bytes from the same network events
(the body, excluding headers). The raw transfer total comes from
`Network.loadingFinished`. A completed response without decoded-byte events is
inconclusive, not a fabricated zero-byte body. Genuine `Network.loadingFailed`
requests remain in `errorRate`; an uncompleted speculative prefetch at the
capture boundary is recorded separately as pending and makes the run
inconclusive without counting as a completed success or failure.
Raw entries also record content encoding and cache-dependent request counts.
These are loaded asset costs; a cache hit must not be reported as a fresh wire transfer.
Separate `text/x-component` response bytes are recorded as
`rscResponseWireBytes` in the raw artifact, apart from JavaScript assets and
CDP main-thread work. Next.js may also inline RSC data in the initial HTML;
zero separate RSC bytes does **not** mean zero RSC payload or total page cost.
The `requestCount` and JS/CSS budgets cover the initial public listing only,
matching the PR smoke. All subsequent navigation and throughput requests remain
in the raw request inventory and `fullJourneyRequestCount` trace field.
Fluo serves its benchmark static assets with gzip when the browser advertises
it; an uncompressed Fluo response cannot be compared to a gzip-compressed peer
under the `compressed*Bytes` budgets. The browser trace records each response's
`contentEncoding` and `cacheControl`; `matched-cache` disables browser cache
reuse for every application through CDP, while `native` retains each host's
default policy. It does not rewrite response cache headers or force one
compression codec: the measured hosts may deliver gzip, Brotli, or identity
bytes. Relative encoded-byte bands compare **delivered wire cost under each
host's recorded encoding**, not equal-codec compression ratios. Neither mode
makes session responses public-cacheable.
CPU/RSS are post-workload `ps` snapshots of the actual server PID, not isolated
interval averages. The trace records generator PID, CPU, and RSS alongside the
server sample; inspect competing processes and generator headroom before
interpreting throughput or inferring capacity.

`config/representative.json` drives separate development runs against each
framework's dev command. The Fluo fixture uses `src/fluo-dev.mjs`: its existing
production Vite build and server are restarted after each source edit, then
the browser reloads. This measures today's build/restart baseline, **not**
Fast Refresh or CSS HMR; #3876/#3877 own those capabilities. This benchmark-only Fluo
build/restart harness is **not** the generated starter's `fluo dev` Vite
middleware lifecycle; its edit times describe this fixture and do not establish
canonical Fluo development latency or peer development parity. The three peer
fixtures run their own development commands. TanStack's route loader edit
in `src/routes/index.tsx` is measured by restarting its development server
and opening the changed page: its Vite client update is not a reliable
server-edit visibility signal. The recorded server-edit time includes that
restart instead of claiming automatic HMR. Next.js CSS and server edits also
restart and reopen the fixture because their updates did not reliably become
visible in the browser. These restart paths do not measure native CSS/server HMR;
the raw timing records `method: dev-server-relaunch`. Each React, CSS, and server edit starts a
fresh development server and browser so earlier edits cannot contaminate
later measurements. Every experiment edits a real source file, subscribes
to the relevant browser-visible change before the edit, and restores the
original bytes afterward. Cold-ready
includes the first usable HTTP page. Production servers are stopped before
development edits to prevent build output from contaminating production
samples. Raw production and development traces remain separate and a combined
trace names both sources. An unavailable edit is inconclusive, not zero.

## Ownership

Fluo's HTTP dispatcher retains route/DTO/guard/status/cookie/response ownership.
The benchmark does not invent a second public matcher, action router or RPC path.
The HTTP/DI suites retain their local-only policy. #3884/#3885 own measured
optimizations; #3876/#3877 own dev performance changes; #3879 owns final full
user-journey acceptance. This suite's incomplete fixtures must never be presented
as product completion evidence.
