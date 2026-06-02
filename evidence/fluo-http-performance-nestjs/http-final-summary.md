# HTTP Final Fastify Benchmark Summary

Date: 2026-06-02
Source: `local-tarball`
Command: `BENCH_TARGETS=nestjs-fastify,fluo-fastify BENCH_FLUO_SOURCE=local-tarball BENCH_RUNS=5 BENCH_WARMUP_SEC=10 BENCH_MEASURE_SEC=40 BENCH_CONNECTIONS=100 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/http-final.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench`

Environment:
- Node.js `v22.19.0`
- Platform `darwin/arm64`
- CPU `Apple M2 Max`, 12 cores
- Connections `100`
- Warmup `10s`
- Measure `40s`
- Runs `5`

## Results

| Scenario | Target | req/sec avg | req/sec stddev | p50 ms | p97.5 ms | p99 ms | errors | timeouts | non2xx | mismatches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| read-search-local | Nest+Fastify | 29584.88 | 309.00 | 3 | 3.2 | 5.8 | 0 | 0 | 0 | 0 |
| read-search-local | fluo+Fastify | 21526.56 | 1787.04 | 3.8 | 6 | 7.2 | 0 | 0 | 0 | 0 |
| json-command-local | Nest+Fastify | 31267.64 | 2132.71 | 2.6 | 4.4 | 5 | 0 | 0 | 0 | 0 |
| json-command-local | fluo+Fastify | 26031.52 | 1000.89 | 3 | 5 | 6.2 | 0 | 0 | 0 | 0 |
| rest-route-mix-local | Nest+Fastify | 45771.84 | 4808.92 | 1.4 | 3 | 3.8 | 0 | 0 | 0 | 0 |
| rest-route-mix-local | fluo+Fastify | 32005.80 | 2433.38 | 2.6 | 4 | 5 | 0 | 0 | 0 | 0 |

## Geometric Mean

- Nest+Fastify: `34854.14 req/sec`
- fluo+Fastify: `26175.86 req/sec`
- Delta: `-24.9%`

## Verdict

Fail. `fluo+Fastify` did not reach `Nest+Fastify +5%` geometric mean req/sec and had worse p99 latency in every measured scenario.

Correctness counters were all zero, so the failure is performance-only rather than response correctness.

See `evidence/fluo-http-performance-nestjs/no-go.md`.
