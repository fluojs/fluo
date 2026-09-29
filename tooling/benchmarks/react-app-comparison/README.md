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
