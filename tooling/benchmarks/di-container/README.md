# DI container focused benchmark

This local-only benchmark isolates `@fluojs/di` provider plan cache paths without starting HTTP servers or measuring end-to-end request handling.

## Scenarios

- repeated `Container.resolve(...)` for a singleton dependency chain
- repeated `hasRequestScopedDependency(...)` for request-scoped dependency detection
- alias-chain provider resolution
- multi-provider token resolution
- transient dependency-chain resolution

Each scenario reports both:

- `cold-plan`: prebuilt containers whose first measured lookup has not populated that container's plan cache
- `warm-plan`: repeated lookups against a stable container after warm-up has populated reusable plans

The cold/warm split is intentionally local and deterministic. It does not use HTTP throughput as evidence for DI internals.

## Run

Build packages first so the benchmark imports local `dist` artifacts:

```bash
pnpm build
pnpm bench:di-container
```

Quick smoke run:

```bash
BENCH_SMOKE=1 BENCH_WARMUP_ITERATIONS=10 pnpm bench:di-container
```

Useful knobs:

- `BENCH_ITERATIONS` — measured iterations per scenario, default `5000`
- `BENCH_WARMUP_ITERATIONS` — warm-up iterations before measurement, default `1000`
- `BENCH_OUTPUT_JSON` — optional path for raw JSON output
