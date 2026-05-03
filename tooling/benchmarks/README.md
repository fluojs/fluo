# Benchmark tooling

The benchmark tooling is intentionally local-only and not wired into default CI because the suites are performance evidence tools, not release gates.

## Focused internal benchmarks

- [`di-container`](./di-container) isolates DI provider lookup/resolution plan cache paths.
- [`runtime-module-graph`](./runtime-module-graph) isolates repeated module graph compilation with cache-off/cache-on modes.

Run both after building local packages:

```bash
pnpm build
pnpm bench:di-container
pnpm bench:runtime-module-graph
```

For PR smoke checks, use reduced deterministic runs:

```bash
BENCH_SMOKE=1 BENCH_WARMUP_ITERATIONS=10 pnpm bench:di-container
BENCH_SMOKE=1 BENCH_WARMUP_ITERATIONS=10 pnpm bench:runtime-module-graph
```

## HTTP comparison benchmark

The existing [`http-comparison`](./http-comparison) suite remains separate. HTTP end-to-end results should not be used as proof for DI or module graph internal wins unless a benchmark explicitly isolates those paths.
