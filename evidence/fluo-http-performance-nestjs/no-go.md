# No-Go Report: Fastify Same-Environment Target

Date: 2026-06-02

## Decision

No-go for the original Fastify performance target.

`fluo+Fastify` did not beat `Nest+Fastify` by `+5%` geometric mean req/sec. It measured `-24.9%` geometric mean req/sec and had worse p99 latency in all three final local-tarball scenarios.

## Evidence

Final benchmark:
- JSON: `evidence/fluo-http-performance-nestjs/http-final.json`
- Terminal capture: `evidence/fluo-http-performance-nestjs/task-7-http-final.txt`
- Summary: `evidence/fluo-http-performance-nestjs/http-final-summary.md`

Correctness:
- `errors=0`
- `timeouts=0`
- `non2xx=0`
- `mismatches=0`

## Remaining Bottleneck

The kept focused optimizations improved isolated hot paths, but not enough to overcome practical Fastify workload overhead:
- Dispatcher native pre-matched fast path improved `+14.4%` in Task 3.
- DI singleton multi-provider warm path improved `+143.3%` in Task 5.
- Final HTTP still lagged Nest+Fastify by `16.7%` to `30.1%` per scenario.

The highest remaining gap is not response correctness or native route eligibility. Task 2 and Task 4 evidence show benchmark routes do use the native/fast path where safe, and final counters are zero. The likely remaining bottleneck is per-request framework work still present inside the contract-safe path: request context setup, binding/request DTO handling, controller invocation policy, response policy, and adapter handoff overhead.

## Contract Boundary

No external contract-breaking optimization was kept:
- No public adapter options changed.
- No public exports/import paths changed.
- No documented error/status/body behavior changed.
- Multipart, raw-body, normalization, SSE, abort, middleware, and fallback semantics remained guarded by tests.

## Next Safe Experiments

1. Profile final local-tarball Fastify runs with CPU sampling to split time between Fastify adapter handoff, dispatcher context construction, DTO binding, and response writing.
2. Measure request-context creation cost separately for singleton no-middleware routes, including AsyncLocalStorage usage and observer hooks.
3. Add a contract-safe benchmark scenario for pre-bound handler invocation with DTO-less and DTO-bound controllers to isolate binding overhead.
4. Consider a private precompiled request-context factory for fast-path-eligible singleton routes only if profiling shows repeated allocation dominates.

Stop condition: do not pursue an optimization that requires changing public `FrameworkRequest`, `RequestContext`, adapter options, decorator semantics, body parsing limits, or documented response/error behavior.
