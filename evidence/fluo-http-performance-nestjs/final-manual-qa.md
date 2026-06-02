# Final Manual QA

Date: 2026-06-02

## Result

Pass for manual QA execution. The performance verdict remains no-go.

## Benchmark Rerun

Command:

```text
BENCH_TARGETS=nestjs-fastify,fluo-fastify BENCH_FLUO_SOURCE=local-tarball BENCH_RUNS=5 BENCH_WARMUP_SEC=10 BENCH_MEASURE_SEC=40 BENCH_CONNECTIONS=100 BENCH_OUTPUT_JSON=/Users/tilda-frontend-jinho/Documents/fluo/.worktrees/fluo-http-performance-nestjs/evidence/fluo-http-performance-nestjs/http-final-rerun.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench
```

Artifacts:

- `evidence/fluo-http-performance-nestjs/http-final-rerun.json`
- `evidence/fluo-http-performance-nestjs/final-wave-json-check.txt`

Result:

- Nest+Fastify geometric mean: `34806.24 req/sec`
- fluo+Fastify geometric mean: `26125.60 req/sec`
- Delta: `-24.94%`
- Correctness counters: `errors=0`, `timeouts=0`, `non2xx=0`, `mismatches=0`

## curl Route Check

Command:

```text
PORT=3106 BENCH_APP_SHAPE=read-search-local BENCH_NODE_ADAPTER=fastify node dist/fluo-fastify/fluo/server.js
curl -i 'http://127.0.0.1:3106/tenants/t-001/users?role=admin&status=active&region=west&sort=createdAt&page=2&limit=25'
```

Artifacts:

- `evidence/fluo-http-performance-nestjs/final-wave-curl.txt`
- `evidence/fluo-http-performance-nestjs/final-wave-server.log`
- `evidence/fluo-http-performance-nestjs/final-wave-port-cleanup.txt`

Result:

- `HTTP/1.1 200 OK`
- `content-type: application/json; charset=utf-8`
- Response body includes `tenantId: "t-001"`, `page: 2`, `limit: 25`, `total: 83`, and 25 user items.

## Cleanup

The QA server on port `3106` was terminated. `lsof -nP -iTCP:3106 -sTCP:LISTEN` produced no listener output after cleanup.

The first two curl capture attempts failed due to an evidence path/shell grouping mistake before the successful absolute-path run. No server was left running from those failed attempts.
