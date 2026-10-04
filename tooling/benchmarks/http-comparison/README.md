# HTTP runtime benchmark

Runs HTTP comparisons for seven platforms: Fastify, Express, Node.js, Bun,
Deno, Cloudflare Workers, and Next.js. Every platform has a `native-*` and
`fluo-*` target; Fastify and Express additionally have a `nestjs-*` target.
Nest comparisons stay within the same Node host engine. Cross-runtime results
must not be described as framework overhead alone.

## Scenarios

The default suite is intentionally limited to three practical local API workloads rather than isolated framework-floor microbenchmarks:

- `read-search-local`: a read-heavy tenant user search endpoint with a path param, six query fields, DI service dispatch, deterministic in-memory filtering, pagination, and JSON serialization.
- `json-command-local`: a POST quote-calculation command with JSON body materialization, nested line items, deterministic tax/discount/shipping computation, and response serialization.
- `rest-route-mix-local`: a small REST surface that cycles through project detail, task list, task detail, POST preview, and comment summary routes to exercise mixed route matching, path/query extraction, GET/POST dispatch, and DI.

## Run

```bash
pnpm install --frozen-lockfile
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace install --frozen-lockfile
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench
```

This benchmark has its own lockfile and is intentionally excluded from the root pnpm workspace. The fluo dependencies resolve through `link:../../../packages/*`, so the suite measures the current worktree package builds while keeping the benchmark's external dependency graph isolated.

Every `bench` invocation first runs the existing root `pnpm build` path (including package clean prebuilds), then compiles the selected servers. It does not trust pre-existing linked package `dist` files. The runner starts an isolated server set for each scenario, so each workload registers only the routes it needs. It warms one target immediately before measuring that same target, then proceeds to the next target; warm-ups never run concurrently. Defaults are `autocannon` at 100 connections for 40 seconds over five runs. Measurement order rotates by scenario/run to avoid always giving one framework the same position. The mixed REST scenario uses the same fixed GET/POST cycle independently on each connection, with separate request bodies and headers. Completed request counts and final partial cycles still depend on throughput and the duration cutoff.

For quick directional runs, override the defaults with environment variables. Use `BENCH_TARGETS` to build and run only selected targets:

```bash
BENCH_RUNS=1 BENCH_WARMUP_SEC=1 BENCH_MEASURE_SEC=3 BENCH_CONNECTIONS=8 BENCH_OUTPUT_JSON=benchmark-results-smoke.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench
BENCH_TARGETS=fluo-bun BENCH_RUNS=1 BENCH_WARMUP_SEC=1 BENCH_MEASURE_SEC=3 BENCH_CONNECTIONS=8 BENCH_OUTPUT_JSON=benchmark-results-bun-smoke.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench
```

`BENCH_TARGETS` accepts a comma-separated subset of the 16 target names.
Platform suffixes are `fastify`, `express`, `nodejs`, `bun`, `deno`, `workers`,
and `nextjs`. Unknown names fail rather than silently skipping a target.

`BENCH_CONCURRENCY_SWEEP=1,16,64,256` selects several concurrency levels.
`BENCH_CONFIGURATION=default` preserves each product's baseline settings.
`BENCH_CONFIGURATION=equivalent` adds Fluo's seven default security headers
to the native and Nest responses; Fluo's security defaults remain enabled.
This normalizes that response behavior, not every feature of the products.
All targets use the same deterministic workloads and JSON payloads; body
parser limits, host initialization, and framework routing remain host-specific.

Only one target server runs at a time. Each condition starts a fresh process,
records process-to-ready time and its first HTTP response, warms the target,
and then measures it. Next's process startup and lazy backend's first request
are separate observations. Local workerd startup is not a deployed isolate's
cold start. Next targets use a real production App Router host and the public
lazy Fluo facade. Workers targets use real local workerd with `nodejs_compat`
enabled for both native and Fluo. Neither is evidence of deployed performance.

The local `.npmrc` isolates dependency installation from the root workspace.
Next's TypeScript dependencies are preinstalled in this package. Its fixtures
compile shared TypeScript workloads before running the production build.

To collect a repeat-average for specific scenarios, set `BENCH_RUNS` and a comma-separated `BENCH_SCENARIOS` list. The console report includes req/s mean, median, sample standard deviation and min/max. One run has no estimable sample standard deviation (`N/A`/JSON `null`). Latency percentiles are explicitly **means of per-run percentiles**, not percentiles of pooled requests. `BENCH_OUTPUT_JSON` controls where full autocannon results, per-run client CPU and aggregate statistics are written:

```bash
BENCH_RUNS=5 BENCH_OUTPUT_JSON=benchmark-results.json BENCH_SCENARIOS=read-search-local,json-command-local,rest-route-mix-local pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench
```

The `fluo+Bun` target requires the `bun` CLI because `@fluojs/platform-bun` uses `globalThis.Bun.serve()` at listen time.

## Correctness gates

Each warm-up and measured run validates the exact body **and status for the request that produced it**. GET routes expect HTTP 200; POST routes expect both frameworks' default HTTP 201. A valid body from a different mixed route does not pass. Traffic fails on:

- connection errors
- timeouts
- non-2xx responses
- request-specific body or status mismatches
- no completed requests

Fluo and Nest keep their idiomatic bindings (`RequestContext` versus parameter decorators) but call the same query/body normalization functions. Missing quote bodies throw rather than falling back to `QUOTE_REQUEST`; a broken body-materialization path cannot produce the fixture response.

`requests[].onResponse` performs request-specific checks. In installed autocannon 7.15, global `verifyBody` receives only the body and runs after preparing the next request; it is not used to infer request identity. Fixed request entries avoid mutable `setupRequest` state.

Run Node-only regression tests (no Bun required) with:

```bash
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace test
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace typecheck
```

Typechecking requires the root workspace build first. Tests use real HTTP and autocannon with finite request counts; no sleeps or polling.

JSON schema version 3 preserves raw results under `sweeps[].rawRuns`,
client CPU samples, response latency histograms, server process-tree CPU/RSS
samples, cold-start boundaries, the request/response contract, runtime versions,
installed dependencies and resolved paths, Fastify/Express host-version checks,
lockfile hashes, Git SHA/dirty state, build commands, and benchmark source
contents with a digest. Latency reports distinguish means of run percentiles
from pooled response-histogram percentiles. RSS is sampled every 250 ms;
short-lived descendants between samples may be missed. The CPU sampling
interval includes the load invocation, including remote invocation overhead.
Keep artifacts with published results; interrupted runs preserve completed
conditions but do not become successful baselines.

Completed samples are registered before target teardown. Ordinary failures and
handled SIGINT/SIGTERM retain completed conditions plus `invalidAttempts`,
including the target, repeat, phase, available traffic diagnostics and server
samples. Load subprocess failures retain their raw stdout/stderr. A signal can
arrive before a load subprocess returns its final counters; the artifact marks
that interruption rather than inventing missing counters. SIGKILL and power loss
cannot flush in-memory state. The archive command rejects recorded invalid
attempts even if the remaining measurement matrix appears complete.

## Independent load generators

`BENCH_LOAD_PROCESS=1` runs the local generator in a separate Node process.
For an SSH-accessible load machine, build `src/load-client.ts` with esbuild
(`--bundle --platform=node --format=esm --packages=external`) and install the
isolated `load-generator/package.json` dependencies beside `load-client.mjs`.
Record the remote dependency lockfile and machine/runtime identity.
Use preconfigured SSH authentication; never put credentials in benchmark files.

- `BENCH_SSH_HOST`: load machine's SSH alias or user/host.
- `BENCH_REMOTE_DIR`: absolute directory containing that isolated generator.
- `BENCH_SSH_CONTROL`: optional existing SSH control socket.
- `BENCH_SERVER_HOST`: server address reachable directly by the load machine.
- `BENCH_BIND_HOST`: server bind address; loopback remains the default where
  the fixture specifies a bind address.

Traffic goes directly over HTTP between machines, not through an SSH tunnel.
SSH launches the generator and returns raw measurements. Generator CPU refers
to the remote process; server CPU is sampled on the server machine.

`src/headroom.ts` compares one versus four generator processes at the same
total 64 connections over three alternating repeats. Set one `BENCH_TARGETS`,
one `BENCH_SCENARIOS`, and `BENCH_OUTPUT_JSON`; use `BENCH_LOAD_PROCESS=1`
for the local process comparison or the SSH variables for remote comparison.
These diagnostics retain each worker's overlapping, unsynchronized interval
and are not a performance baseline. More generators increasing throughput
while the server remains underutilized is evidence against generator headroom.

## Scope and caveats

- This measures the current workspace package builds through linked fluo dependencies, not the released npm beta surface.
- fluo uses TC39 standard decorators without `emitDecoratorMetadata`; NestJS uses legacy decorators with `emitDecoratorMetadata` through `nestjs/tsconfig.json`.
- `fluo+Bun` is a runtime comparison, not a same-adapter comparison. Treat it as “same fluo app graph on Bun’s native server” versus the Node.js adapter targets.
- The suite covers routing, request binding, local deterministic service work, and JSON serialization. It does not measure validation plugins, serialization plugins, guards, pipes, database access, or production middleware.

### Load-generator limits

Client CPU is measured around each autocannon invocation using process user + system CPU time divided by monotonic elapsed wall time. 100% means one core, not all machine cores. The sample includes verification, GC/helper threads and result aggregation, excludes server subprocess CPU, and is an interval average rather than a peak. The report flags samples consuming at least one core as potential generator saturation; this is not proof, a hardware-independent threshold for healthy load, or a framework winner verdict. Near-one-core usage warrants investigating client headroom, and lower averages cannot exclude bursts. The client and all servers share one host, so scheduler contention, CPU scaling and thermals remain confounders. Confirm headroom from a separate load host before interpreting a throughput ceiling as server capacity.

Throughput deltas are descriptive mean differences, not significance tests.
Short smoke runs validate execution and correctness only. A complete baseline
requires all seven platforms, both configurations, repeated concurrency
conditions, valid responses, and separately established generator headroom.
Missing or inconclusive evidence must remain incomplete.
