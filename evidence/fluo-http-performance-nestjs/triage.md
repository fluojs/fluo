# Task 6 Focused Benchmark Triage

Date: 2026-06-02
Worktree: `/Users/tilda-frontend-jinho/Documents/fluo/.worktrees/fluo-http-performance-nestjs`

## Keep

### HTTP dispatcher synchronous fast-path execution

Decision: keep.

Evidence:
- Baseline: `evidence/fluo-http-performance-nestjs/task-3-http-dispatch-baseline.txt`
- Final: `evidence/fluo-http-performance-nestjs/task-3-http-dispatch-final.txt`
- Native pre-matched fast path improved from `372488.61 ops/sec` to `426114.80 ops/sec`, a `+14.4%` increase.

Contract check:
- Public `@fluojs/http` surface test passed in Task 3.
- Error, abort, SSE, middleware, and fallback paths remained covered by dispatcher tests.

### Fastify native-route request handling split

Decision: keep.

Evidence:
- Adapter test artifact: `evidence/fluo-http-performance-nestjs/task-4-adapter-test.txt`
- HTTP smoke JSON: `evidence/fluo-http-performance-nestjs/task-4-http-smoke.json`
- Manual curl: `evidence/fluo-http-performance-nestjs/task-4-json-command-curl.txt`
- Multipart fallback: `evidence/fluo-http-performance-nestjs/task-4-multipart-fallback.txt`

Observed HTTP smoke:
- `read-search-local`: fluo+Fastify `20070.55 req/sec`, Nest+Fastify `30448.73 req/sec`, all correctness counters `0`.
- `json-command-local`: fluo+Fastify `27734.40 req/sec`, Nest+Fastify `30726.55 req/sec`, all correctness counters `0`.

Rationale:
- The change is contract-safe and keeps multipart, raw-body, and normalization fallbacks.
- It reduces per-request work for static native routes by resolving safe URL parts from precomputed route metadata.
- It does not by itself satisfy the final Fastify comparison; Task 7 must decide final pass/no-go from repeated local-tarball benchmarks.

### DI singleton multi-provider resolved-token cache

Decision: keep.

Evidence:
- Baseline: `evidence/fluo-http-performance-nestjs/di-task5-before.json`
- Final: `evidence/fluo-http-performance-nestjs/di-before-after.json`
- Smoke: `evidence/fluo-http-performance-nestjs/task-5-di-smoke.json`

Measured result:
- `resolve multi-provider token warm-plan` improved from `385388.62 ops/sec` to `937565.98 ops/sec`, a `+143.3%` increase.

Contract check:
- Cached resolved lists are internal only.
- Callers still receive fresh arrays; `packages/di/src/container.test.ts` covers caller mutation isolation.
- The cache is restricted to root singleton multi-provider tokens and is cleared with resolution plan caches on graph changes.

## Drop

### DI lineage revision tracker attempt

Decision: dropped.

Reason:
- Initial attempt cached lineage revision strings, but focused benchmark output regressed cold-plan and alias/multi paths.
- The change was removed before Task 5 completion and is not present in the final diff.

## Follow-On Risk

The Task 4 HTTP smoke still shows fluo+Fastify behind Nest+Fastify in the measured scenarios. Task 7 must run repeated final same-environment local-tarball benchmarks and either prove the target or write `no-go.md` with the remaining bottleneck.
