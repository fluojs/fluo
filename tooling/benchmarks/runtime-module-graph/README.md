# Runtime module graph focused benchmark

This local-only benchmark isolates repeated `compileModuleGraph(...)` work for `@fluojs/runtime`. It does not start HTTP adapters and does not use HTTP throughput as evidence for module-graph cache behavior.

## Scenarios

- `small-root` — compact root module with a few imported feature modules
- `wide-imports` — root module importing a wider set of deterministic feature modules
- `runtime-providers` — same compile path with bootstrap runtime providers included in the cache key
- `validation-tokens` — same compile path with validation tokens included in the cache key
- `metadata-invalidation` — repeatedly changes DI metadata so cache-key invalidation and failed-compile non-caching stay exercised

Each stable scenario reports:

- `cache-off`: repeated compile with `moduleGraphCache` omitted
- `cache-on`: repeated compile with `moduleGraphCache: true`

## Run

Build packages first so the benchmark imports local `dist` artifacts:

```bash
pnpm build
pnpm bench:runtime-module-graph
```

Quick smoke run:

```bash
BENCH_SMOKE=1 BENCH_WARMUP_ITERATIONS=10 pnpm bench:runtime-module-graph
```

Useful knobs:

- `BENCH_ITERATIONS` — measured iterations per scenario, default `2000`
- `BENCH_WARMUP_ITERATIONS` — warm-up iterations before measurement, default `200`
- `BENCH_OUTPUT_JSON` — optional path for raw JSON output
