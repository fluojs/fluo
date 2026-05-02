# HTTP runtime benchmark

Runs a small HTTP throughput/latency comparison between the latest published fluo npm beta packages and NestJS v11 across three targets:

- `Nest+Fastify`
- `fluo+Fastify`
- `fluo+Bun`

## Scenarios

The default suite is intentionally limited to three practical local API workloads rather than isolated framework-floor microbenchmarks:

- `read-search-local`: a read-heavy tenant user search endpoint with a path param, six query fields, DI service dispatch, deterministic in-memory filtering, pagination, and JSON serialization.
- `json-command-local`: a POST quote-calculation command with JSON body materialization, nested line items, deterministic tax/discount/shipping computation, and response serialization.
- `rest-route-mix-local`: a small REST surface that cycles through project detail, task list, task detail, POST preview, and comment summary routes to exercise mixed route matching, path/query extraction, GET/POST dispatch, and DI.

## Run

```bash
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace install --frozen-lockfile
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench
```

This benchmark has its own lockfile and is intentionally excluded from the root pnpm workspace. The fluo dependencies intentionally resolve from the published npm beta surface instead of `../../../packages/*`, so the suite measures the package versions users can install from npm.

The runner starts an isolated server set for each scenario, so each workload registers only the routes it needs. It warms every target for each scenario, then measures with `autocannon` at 100 connections for 40 seconds over five runs by default. Measurement order rotates by scenario/run to avoid always giving one framework the same position. The mixed REST scenario uses a deterministic request cycle so every target sees the same GET/POST sequence.

For quick directional runs, override the defaults with environment variables:

```bash
BENCH_RUNS=1 BENCH_WARMUP_SEC=1 BENCH_MEASURE_SEC=3 BENCH_CONNECTIONS=8 BENCH_OUTPUT_JSON=benchmark-results-smoke.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench
```

Local worktree experiments should use an explicit local dependency setup and label their output as local-worktree results. The default commands above are reserved for published npm beta measurements so lockfile installs include the same external dependency graph consumers receive.

To collect a repeat-average for specific scenarios, set `BENCH_RUNS` and a comma-separated `BENCH_SCENARIOS` list. The console report includes the sample count and req/s standard deviation, and `BENCH_OUTPUT_JSON` controls where raw per-run metrics plus averages are written:

```bash
BENCH_RUNS=5 BENCH_OUTPUT_JSON=benchmark-results.json BENCH_SCENARIOS=read-search-local,json-command-local,rest-route-mix-local pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench
```

The `fluo+Bun` target requires the `bun` CLI because `@fluojs/platform-bun` uses `globalThis.Bun.serve()` at listen time.

## Correctness gates

Each warm-up and measured run validates the expected response body and fails on:

- connection errors
- timeouts
- non-2xx responses
- body mismatches

The report prints those counters with throughput, latency, sample count, and req/s variability metrics. The JSON output keeps raw run samples so later reports can recompute means or compare releases without scraping terminal tables.

## Scope and caveats

- This measures the released npm beta surface, not uncommitted local worktree package builds.
- fluo uses TC39 standard decorators without `emitDecoratorMetadata`; NestJS uses legacy decorators with `emitDecoratorMetadata` through `nestjs/tsconfig.json`.
- `fluo+Bun` is a runtime comparison, not a same-adapter comparison. Treat it as “same fluo app graph on Bun’s native server” versus the Node.js adapter targets.
- The suite covers routing, request binding, local deterministic service work, and JSON serialization. It does not measure validation plugins, serialization plugins, guards, pipes, database access, or production middleware.
