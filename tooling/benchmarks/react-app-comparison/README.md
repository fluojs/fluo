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
four frozen apps; provenance records `environment.serverNodeEnv`. Development
runners remain separate. Earlier development/unset-renderer measurements remain
archived rather than serving as a matched production verdict.

The shared passive Chromium NetLog observer authenticates missing CDP cancellation
terminals only through a unique exact native source clock and reciprocal lifetime
chain before capture. Original CDP observations remain intact; missing, contradictory
or ambiguous chains remain inconclusive. Native/CDP trace hashes and containment
are checked before evaluation. Logging overhead is included on both matched sides,
not measured separately. The page stays live through throughput and the unchanged
post-workload `ps` CPU/RSS snapshot; budgets, peer defaults and metric meanings do
not change.

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

Fluo development runs the existing canonical `fluo dev --runner fluo` integration,
not a production build/watch adapter. The fixture follows the shipped CLI template:
Vite middleware and its gateway WebSocket, refresh preamble before hydration,
current SSR destination loads, and the existing graph supervisor. The original
production entry and manifest keys, hashed split destinations and `/assets/`
serving remain independent of development. CSS and React stimuli observe visible
HMR without an explicit reload; the server stimulus waits for app-generation
readiness, then requests a fresh document to observe its changed HTTP data.
The edit-to-visible interval still starts before the source edit and ends at the
same visible text/computed-style assertion.
For document reloads, completion observes that marker in the newly committed
main-frame document without waiting for unrelated resources to finish loading.
Required generation readiness and relaunch readiness remain inside their
recorded intervals. The same collector applies to every peer and the baseline.
This observation correction also requires
identical-method baseline remeasurement; it does not relax budgets or turn
historical fail/inconclusive results into a performance PASS.

Optional `dev.<framework>.readiness` authenticates HMR before source edits.
The collector subscribes to CDP before navigation and requires the exact socket
origin/path, successful upgrade and structured readiness message. Installed Vite
8.0.3/8.2.2/8.3.1 uses the `vite-hmr` subprotocol and `{"type":"connected"}`;
Next 16.3.6 App Router with `--webpack` uses `/_next/hmr?id=...` (no subprotocol)
and a `type: "sync"` message with a compilation hash and no errors.
Arbitrary sockets, console text and socket-open events cannot satisfy readiness.
The event wait is bounded, cleans up listeners, and adds no sleep or polling.
HTTP-only fixtures without this optional field still require no WebSocket.

All initial HMR waiting is included in `devColdReadyMs` and each subsequent
edit experiment's recorded restart readiness. An edit-specific document
navigation authenticates its new connection too; its navigation/readiness time
is added to that experiment's ready step, before the unchanged edit interval.
Relaunch edits include readiness in their edit interval and retain the restart
observation. Raw timings retain the socket identity, exact message, CDP timestamp
and elapsed observation time. HMR connection is not hydration or module
registration completion. All four representative dev peers additionally opt into
`dev.<framework>.reactReadiness: { "timeoutMs": 60000 }`, using the same
`react-initial-completion-v1` observer before initial and edit-route navigation.
The entire React completion wait is included in cold-ready or the edit-navigation
ready step, never hidden before the React edit timer. Raw `reactReadiness` evidence
records renderer versions/bundle types, load, commit/passive events and completion.
The synthetic hook supplies the renderer registry required by Fast Refresh;
installed hooks retain their identity and callbacks. Omitting `reactReadiness`
or setting it to `false` preserves HTTP-only/no-React fixtures. Production keeps
its existing 10-second observer deadline and completion contract.
Recollect the baseline with this same readiness method before comparing edit
latencies. Budgets, counts, peer commands and production capture remain frozen.

The focused real-dev check requires installed linked packages and Chromium:

```sh
node --test tooling/benchmarks/react-app-comparison/tests/fluo-dev.test.mjs
```

It subscribes to browser mutations and app readiness before edits, restores the
stimulus sources after shutdown, checks fresh SSR, and verifies child exit and
public-port release. This is a correctness check, not a performance gate.

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
framework's dev command. The Fluo fixture uses `src/fluo-dev.mjs` to launch the
canonical `fluo dev --runner fluo` Vite middleware lifecycle. React and CSS
edits use browser-visible updates; server edits wait for application-generation
readiness and reload the document to observe the changed marker. These are
measurements of the seeded fixture through canonical Fluo development, not a
production-build restart proxy or proof of peer development parity. The three
peer fixtures run their own development commands. TanStack's route loader edit
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
