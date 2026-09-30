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
