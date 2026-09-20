# DI container focused benchmark

This local-only benchmark measures `@fluojs/di` cold and warm resolution paths without starting HTTP servers or measuring end-to-end request handling.

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

## Interpretation

The singleton, alias, and multi-provider cold paths include first-time instance
creation, while their warm paths can reuse resolved instances. Their difference
is not a measurement of plan-cache savings alone. The transient scenario still
creates instances after warm-up; request-scope detection measures dependency
inspection rather than request-scoped instance resolution.

Each result is one timed batch, and cold always precedes warm. Iterations within
that batch are not independent experimental samples. Use these numbers for local
diagnosis, not statistical claims about small improvements. For comparisons,
repeat the process, alternate revision order, and retain each output alongside
the exact revision and runtime version. Package builds must match that revision.

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
