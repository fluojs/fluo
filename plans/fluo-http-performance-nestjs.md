# fluo HTTP Performance vs NestJS

## TL;DR
> **Summary**: fluo HTTP 처리량을 NestJS보다 높이는 목표를 benchmark 신뢰성부터 hot-path 최적화, 회귀 방지, published-package evidence까지 연결하는 단일 실행 계획이다.
> **Deliverables**:
> - `tooling/benchmarks/http-comparison` local tarball benchmark lane
> - fluo fast-path/native-route 실제 적용 증거
> - HTTP dispatcher, Fastify adapter, DI/runtime hot-path 최적화
> - Nest+Fastify/Nest+Express 대비 fluo+Fastify/fluo+Express throughput/latency report
> - public package changesets/docs impact
> **Effort**: Large
> **Parallel**: YES - 5 waves
> **Critical Path**: Task 1 -> Task 2 -> Tasks 3/4/5 -> Task 6 -> Task 7 -> Task 8

## Context
### Original Request
fluo 프레임워크의 성능이 같은 환경에서 NestJS보다 떨어지는 듯하고, 개발 초기라도 가능하면 NestJS보다 더 빠른 처리량을 보여주고 싶다.

### Interview Summary
- 사용자의 최신 조건을 적용한다: 동일 Node.js runtime에서 `Fastify` adapter끼리, `Express` adapter끼리 비교한다.
- `fluo+Bun`은 추가 참고 runtime comparison이지 같은 adapter 비교가 아니므로 최종 성공 판단에는 포함하지 않는다.
- public `@fluojs/*` package 변경은 behavior contract를 보존하고 Changesets를 포함한다.

### Metis Review
- 공정성 gap: 기존 benchmark는 published beta package lane이라 local source 개선 검증과 분리해야 한다.
- 승패 기준 gap: 최종 pass/fail은 `Nest+Fastify` vs `fluo+Fastify`, `Nest+Express` vs `fluo+Express`를 사용하고 `fluo+Bun`은 참고 지표로 분리한다.
- 통계 gap: req/sec 평균만 금지하고 repeated run, latency p99, variance/sample, correctness counters를 함께 요구한다.
- local-worktree gap: local source 연결 방식은 local package tarball lane으로 고정한다. `pnpm pack`은 허용하지만 `npm publish`는 금지한다.
- profiling gap: existing cache/fast-path 위에 새 cache를 추가하려면 hit-rate, allocation, or benchmark evidence가 먼저 있어야 한다.
- release gap: public package 성능 개선은 `.changeset/*.md`, semver intent, docs/README EN/KO impact 판단이 필요하다.
- user constraint: external contract changes are out of scope. Allowed changes are internal/core-package-to-platform-package integration seams only when public behavior, public exports, documented APIs, and runtime semantics remain identical.

## Work Objectives
### Core Objective
동일 환경의 practical HTTP workloads에서 외부 계약을 변경하지 않고 `fluo+Fastify`가 `Nest+Fastify` 대비, `fluo+Express`가 `Nest+Express` 대비 geometric mean req/sec 기준 최소 +5%를 달성하고, 각 scenario의 p99 latency가 같은 adapter의 Nest target보다 악화되지 않도록 한다. 외부 계약 변경 없이는 달성 불가하면 no-go report에 남은 병목, 필요한 contract/upstream 변화, 다음 실험을 기록하고 구현 범위를 중단한다.

### Deliverables
- local tarball worktree benchmark mode and target filter for `tooling/benchmarks/http-comparison`
- published-baseline, local-before, local-after, final benchmark artifacts
- benchmark smoke/unit tests that fail before implementation and pass after
- hot-path unit/regression tests for dispatcher, Fastify adapter, DI/runtime changes
- benchmark JSON reports under `evidence/fluo-http-performance-nestjs/`
- `.changeset/*.md` for changed public packages
- external-contract audit proving no public API/behavior change

### Definition of Done
- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `node tooling/benchmarks/http-dispatch-hot-path.mjs`
- `node tooling/benchmarks/http-dto-binding-plan.mjs`
- `BENCH_SMOKE=1 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/di-smoke.json pnpm bench:di-container`
- `BENCH_SMOKE=1 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/runtime-smoke.json pnpm bench:runtime-module-graph`
- `BENCH_TARGETS=nestjs-fastify,fluo-fastify BENCH_FLUO_SOURCE=local-tarball BENCH_RUNS=5 BENCH_WARMUP_SEC=10 BENCH_MEASURE_SEC=40 BENCH_CONNECTIONS=100 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/http-final-fastify.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench`
- `BENCH_TARGETS=nestjs-express,fluo-express BENCH_FLUO_SOURCE=local-tarball BENCH_RUNS=5 BENCH_WARMUP_SEC=10 BENCH_MEASURE_SEC=40 BENCH_CONNECTIONS=100 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/http-final-express.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench`
- Final HTTP benchmarks have `errors=0`, `timeouts=0`, `non2xx=0`, `mismatches=0`, and `fluo+Fastify` geometric mean req/sec >= `Nest+Fastify` by 5%, `fluo+Express` geometric mean req/sec >= `Nest+Express` by 5%, unless a no-go report proves the remaining bottleneck requires an external contract-breaking or upstream dependency change.

### Must Have
- TDD for every production or benchmark logic change.
- Manual QA through `curl -i` or `tmux` for every user-visible benchmark lane.
- No local `npm publish`.
- No weakening or deleting tests.
- No `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Preserve external contracts: public exports, public import paths, public TypeScript types, decorator semantics, `RequestContext`, `FrameworkRequest`, `FrameworkResponse`, adapter factory options, documented errors/status codes, README/docs/contracts behavior.
- Allowed implementation scope: internal handoff between `packages/core`, `packages/http`, `packages/runtime`, and `packages/platform-*`, including private/internal symbols, dispatcher descriptor metadata, native route handoff metadata, request/response factory internals, and bootstrap adapter wiring.

### Must NOT Have
- No claim that `fluo+Bun` proves same-environment superiority over NestJS.
- No validation/guards/database scope expansion.
- No broad rewrite of the framework.
- No public behavior changes at all. If a proposed optimization requires changing public behavior, write a no-go entry instead of implementing it.
- No public export/import path changes, no renamed public methods/classes/types, no changed adapter option names/default semantics, no changed error/status/body contract, no changed decorator behavior.
- No edits to `node_modules`, `dist`, benchmark generated output except explicit evidence files and generated local tarballs under `tooling/benchmarks/http-comparison/.local-packs/`.
- No new cache unless benchmark/profiling evidence identifies a cache miss, repeated allocation, or hot lookup.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: TDD with Vitest for TypeScript, existing benchmark smoke tests for `.mjs` runners, and HTTP/tmux manual QA.
- QA policy: Every task has agent-executed scenarios.
- Evidence root: `evidence/fluo-http-performance-nestjs/`

## Execution Strategy
### Parallel Execution Waves
Wave 1: Task 1, Task 2
Wave 2: Task 3, Task 4, Task 5
Wave 3: Task 6
Wave 4: Task 7
Wave 5: Task 8 and Final Verification Wave

### Dependency Matrix
- Task 1 blocks Tasks 2, 7, 8.
- Task 2 blocks Tasks 3, 4, 6, 7.
- Tasks 3, 4, 5 can run in parallel after Task 2.
- Task 6 depends on Tasks 3, 4, 5.
- Task 7 depends on Task 6.
- Task 8 depends on Task 7.

## TODOs
- [x] 1. Add local tarball worktree, target-filter, and baseline benchmark lane

  **What to do**: Extend `tooling/benchmarks/http-comparison/src/run.ts` so executor can run only `nestjs-fastify,fluo-fastify`, only `nestjs-express,fluo-express`, or optional `fluo-bun`, and can choose `BENCH_FLUO_SOURCE=published|local-tarball`. Local mode must build affected packages, run `pnpm pack` into `tooling/benchmarks/http-comparison/.local-packs/`, install the benchmark package against those tarballs, and label output `fluoSource=local-tarball`. Add baseline capture commands for `published-baseline` and `local-before`.
  **Must NOT do**: Do not replace the existing published beta default. Do not require Bun for the same-environment Fastify comparison. Do not use `workspace:*` because this benchmark is intentionally excluded from the root workspace. Do not edit dependency/generated folders except `.local-packs/`.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 2, 7, 8 | Blocked By: none

  **References**:
  - Pattern: `tooling/benchmarks/http-comparison/README.md:24` - current published-package lane semantics.
  - Pattern: `tooling/benchmarks/http-comparison/README.md:34` - local worktree runs must be explicitly labeled.
  - API: `tooling/benchmarks/http-comparison/src/run.ts:56` - `TARGETS` is the target registry to filter.
  - API: `tooling/benchmarks/http-comparison/src/run.ts:570` - build order currently always builds all targets.
  - Script: `tooling/benchmarks/http-comparison/package.json:8` - benchmark entrypoint.

  **Acceptance Criteria**:
  - [x] Add RED test first: `tooling/benchmarks/http-comparison/src/run.test.ts` with test id `it("filters benchmark targets when BENCH_TARGETS selects Fastify-only comparison")`.
  - [x] Add RED test first: `tooling/benchmarks/http-comparison/src/run.test.ts` with test id `it("labels local tarball results without changing published-package defaults")`.
  - [x] Add RED test first: `tooling/benchmarks/http-comparison/src/run.test.ts` with test id `it("writes published-baseline and local-before artifact metadata")`.
  - [x] `pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace typecheck`
  - [x] `BENCH_TARGETS=nestjs-fastify,fluo-fastify BENCH_FLUO_SOURCE=published BENCH_ARTIFACT_LABEL=published-baseline BENCH_RUNS=1 BENCH_WARMUP_SEC=1 BENCH_MEASURE_SEC=3 BENCH_CONNECTIONS=8 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/published-baseline-fastify-smoke.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench`
  - [x] `BENCH_TARGETS=nestjs-fastify,fluo-fastify BENCH_FLUO_SOURCE=local-tarball BENCH_ARTIFACT_LABEL=local-before BENCH_RUNS=1 BENCH_WARMUP_SEC=1 BENCH_MEASURE_SEC=3 BENCH_CONNECTIONS=8 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/local-before-fastify-smoke.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench`
  - [x] `BENCH_TARGETS=nestjs-express,fluo-express BENCH_FLUO_SOURCE=published BENCH_RUNS=1 BENCH_WARMUP_SEC=1 BENCH_MEASURE_SEC=3 BENCH_CONNECTIONS=8 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/published-baseline-express-smoke.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench`
  - [x] `BENCH_TARGETS=nestjs-express,fluo-express BENCH_FLUO_SOURCE=local-tarball BENCH_RUNS=1 BENCH_WARMUP_SEC=1 BENCH_MEASURE_SEC=3 BENCH_CONNECTIONS=8 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/local-before-express-smoke.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench`

  **QA Scenarios**:
  ```text
  Scenario: Fastify-only smoke benchmark
    Tool: tmux
    Steps: tmux new-session -d -s ulw-qa-http-fastify 'cd /Users/tilda-frontend-jinho/Documents/fluo/.worktrees/fluo-http-performance-nestjs && BENCH_TARGETS=nestjs-fastify,fluo-fastify BENCH_FLUO_SOURCE=local-tarball BENCH_ARTIFACT_LABEL=local-before BENCH_RUNS=1 BENCH_WARMUP_SEC=1 BENCH_MEASURE_SEC=3 BENCH_CONNECTIONS=8 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/local-before-fastify-smoke.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench'; tmux capture-pane -pt ulw-qa-http-fastify -S -200
    Expected: output contains Nest+Fastify and fluo+Fastify, does not require fluo+Bun, JSON file exists, all invalid traffic counters are 0
    Evidence: evidence/fluo-http-performance-nestjs/task-1-fastify-smoke.txt

  Scenario: Unknown target fails clearly
    Tool: tmux
    Steps: tmux new-session -d -s ulw-qa-http-target-error 'cd /Users/tilda-frontend-jinho/Documents/fluo && BENCH_TARGETS=unknown BENCH_RUNS=1 BENCH_WARMUP_SEC=1 BENCH_MEASURE_SEC=1 pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench'; tmux capture-pane -pt ulw-qa-http-target-error -S -100
    Expected: non-zero exit and stderr contains Unknown BENCH_TARGETS
    Evidence: evidence/fluo-http-performance-nestjs/task-1-target-error.txt
  ```

  **Commit**: YES | Message: `test(benchmarks): isolate fastify http comparison lane` | Files: `tooling/benchmarks/http-comparison/**`, optional `package.json`

- [x] 2. Prove benchmark routes actually use fluo fast path/native handoff

  **What to do**: Add a benchmark/debug mode that emits per-target fast-path route stats for fluo without affecting measured output. Use existing `fastPathDebugHeaders` and dispatcher stats where available.
  **Must NOT do**: Do not add debug headers by default in production or normal benchmark mode.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 3, 4, 6, 7 | Blocked By: 1

  **References**:
  - API: `packages/http/src/dispatch/dispatcher.ts:70` - `fastPathDebugHeaders` option.
  - API: `packages/http/src/dispatch/dispatcher.ts:1070` - fast-path eligibility compiled per descriptor.
  - API: `packages/http/src/dispatch/dispatcher.ts:1081` - `describeRoutes()` exposed to adapters.
  - API: `packages/platform-fastify/src/adapter.ts:251` - native route registration from dispatcher descriptors.
  - API: `packages/platform-fastify/src/adapter.ts:524` - native route filtering.

  **Acceptance Criteria**:
  - [x] Add RED test first: `packages/http/src/dispatch/dispatcher.test.ts` with test id `it("exposes fast path stats for benchmark-eligible singleton routes")`.
  - [x] Add RED test first: `packages/platform-fastify/src/adapter.test.ts` with test id `it("hands Fastify native routes to dispatchNativeRoute for benchmark-safe paths")`.
  - [x] `pnpm exec vitest run packages/http/src/dispatch/dispatcher.test.ts packages/platform-fastify/src/adapter.test.ts`
  - [x] Benchmark debug output proves all benchmark fluo routes are either `executionPath=fast` or records exact fallback reason.

  **QA Scenarios**:
  ```text
  Scenario: fluo benchmark route fast-path visibility
    Tool: curl -i
    Steps: Start fluo benchmark server with BENCH_FAST_PATH_DEBUG=1 PORT=3101 BENCH_APP_SHAPE=read-search-local pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench:fluo, then curl -i 'http://127.0.0.1:3101/tenants/t-001/users?role=admin&status=active&region=west&sort=createdAt&page=2&limit=25'
    Expected: HTTP/1.1 200, expected JSON body, and fast-path debug header or sidecar stats shows executionPath=fast
    Evidence: evidence/fluo-http-performance-nestjs/task-2-fast-path-curl.txt, evidence/fluo-http-performance-nestjs/task-2-fast-path-debug-all.txt

  Scenario: route with middleware stays full path
    Tool: tmux
    Steps: Run Vitest test id `it("keeps middleware routes off fast path with explicit fallback reason")` and capture output
    Expected: assertion sees fallback reason includes middleware
    Evidence: evidence/fluo-http-performance-nestjs/task-2-middleware-fallback.txt
  ```

  **Commit**: YES | Message: `test(http): expose benchmark fast path evidence` | Files: `packages/http/src/**`, `packages/platform-fastify/src/**`, `tooling/benchmarks/http-comparison/**`

- [x] 3. Optimize HTTP dispatcher fast-path execution without external contract changes

  **What to do**: Profile and remove avoidable allocations/awaits in `dispatchNativeFastRoute`, `tryFastPathExecution`, and `executeFastPath` while preserving abort, SSE, error, observer, middleware, and request-scope semantics. Allowed changes are limited to internal dispatcher/native-handoff/request-context construction and private fast-path metadata.
  **Must NOT do**: Do not route guards, interceptors, middleware, content negotiation, custom binders, or SSE through unsafe fast path. Do not change public `@fluojs/http` exports, public request/response/context shapes, status/error contracts, or documented route behavior.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 6 | Blocked By: 2

  **References**:
  - Hot path: `packages/http/src/dispatch/dispatcher.ts:783` - native fast route dispatch.
  - Hot path: `packages/http/src/dispatch/dispatcher.ts:916` - fast-path execution attempt.
  - Hot path: `packages/http/src/dispatch/dispatcher.ts:987` - shared dispatch fast-path branch.
  - Hot path: `packages/http/src/dispatch/fast-path/fast-path-executor.ts:38` - controller call and response write.
  - Benchmark: `tooling/benchmarks/http-dispatch-hot-path.mjs:220` - dispatch benchmark scenarios.

  **Acceptance Criteria**:
  - [x] Add RED test first for any changed branch in `packages/http/src/dispatch/dispatcher.test.ts`.
  - [x] Add RED external-contract guard test first in `packages/http/src/public-api.test.ts` if any public surface-adjacent file changes.
  - [x] `pnpm exec vitest run packages/http/src/dispatch/dispatcher.test.ts packages/http/src/dispatch/dispatch-routing-policy.test.ts`
  - [x] `pnpm exec vitest run packages/http/src/public-api.test.ts`
  - [x] `node tooling/benchmarks/http-dispatch-hot-path.mjs` shows no regression over captured baseline; target +10% ops/sec for native pre-matched fast path.
  - [x] `pnpm test -- --project packages packages/http/src/dispatch`

  **QA Scenarios**:
  ```text
  Scenario: fast-path GET still returns expected body
    Tool: curl -i
    Steps: Start fluo benchmark read-search server on PORT=3103, then curl -i 'http://127.0.0.1:3103/tenants/t-001/users?role=admin&status=active&region=west&sort=createdAt&page=2&limit=25'
    Expected: HTTP/1.1 200 and body equals READ_SEARCH_RESPONSE from tooling/benchmarks/http-comparison/src/shared/workloads.ts
    Evidence: evidence/fluo-http-performance-nestjs/task-3-read-search-curl.txt

  Scenario: invalid route still uses error policy
    Tool: curl -i
    Steps: curl -i 'http://127.0.0.1:3103/not-found'
    Expected: HTTP status remains the documented not-found response and no process crash
    Evidence: evidence/fluo-http-performance-nestjs/task-3-not-found-curl.txt
  ```

  **Commit**: YES | Message: `perf(http): reduce dispatcher fast path overhead` | Files: `packages/http/src/**`, `tooling/benchmarks/**`, `.changeset/*.md`

- [x] 4. Optimize Fastify native request/response path without adapter contract changes

  **What to do**: Profile `createNativeFastFrameworkRequest`, native route params/query/header handling, response serialization, and fallback conditions. Prefer lazy work and precomputed route metadata. Keep multipart/raw-body and normalization fallback behavior intact. Allowed changes are limited to internal adapter wiring, private request factory behavior, and dispatcher handoff metadata.
  **Must NOT do**: Do not bypass Fastify body limits, multipart limits, raw body preservation, or route normalization safety. Do not change `createFastifyAdapter(...)`, `bootstrapFastifyApplication(...)`, `runFastifyApplication(...)`, public option defaults, public errors, or response serialization semantics.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 6 | Blocked By: 2

  **References**:
  - Hot path: `packages/platform-fastify/src/adapter.ts:257` - native route registration.
  - Hot path: `packages/platform-fastify/src/adapter.ts:311` - native route request handling.
  - Hot path: `packages/platform-fastify/src/adapter.ts:365` - native fast request shell.
  - Guardrail: `packages/platform-fastify/src/adapter.ts:374` - multipart/raw-body fallback.
  - Guardrail: `packages/platform-fastify/src/adapter.ts:898` - native param normalization.
  - Serialization: `packages/platform-fastify/src/adapter.ts:1301` - response body serialization.

  **Acceptance Criteria**:
  - [x] Add RED tests first in `packages/platform-fastify/src/adapter.test.ts` for native route fast request, multipart fallback, raw-body fallback, and params containing `/`.
  - [x] Add RED public-surface guard first if any exported adapter type/function changes; expected outcome is no exported adapter type/function changes.
  - [x] `pnpm exec vitest run packages/platform-fastify/src/adapter.test.ts`
  - [x] `BENCH_TARGETS=nestjs-fastify,fluo-fastify BENCH_SCENARIOS=read-search-local,json-command-local BENCH_RUNS=1 BENCH_WARMUP_SEC=3 BENCH_MEASURE_SEC=10 BENCH_CONNECTIONS=32 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/task-4-http-smoke.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench`

  **QA Scenarios**:
  ```text
  Scenario: JSON command native path
    Tool: curl -i
    Steps: Start fluo benchmark json-command server on PORT=3104, then curl -i -H 'content-type: application/json' --data '{"customerId":"cust-001","coupon":"BETA10","shippingRegion":"west","items":[{"sku":"sku-001","quantity":2,"unitPriceCents":2500},{"sku":"sku-014","quantity":1,"unitPriceCents":7250},{"sku":"sku-105","quantity":3,"unitPriceCents":1250}]}' 'http://127.0.0.1:3104/orders/quote'
    Expected: HTTP/1.1 200 and body equals QUOTE_RESPONSE
    Evidence: evidence/fluo-http-performance-nestjs/task-4-json-command-curl.txt

  Scenario: multipart fallback remains safe
    Tool: tmux
    Steps: Run `pnpm exec vitest run packages/platform-fastify/src/adapter.test.ts -t "multipart"` and capture output
    Expected: multipart tests pass and native route handoff is not used for multipart bodies
    Evidence: evidence/fluo-http-performance-nestjs/task-4-multipart-fallback.txt
  ```

  **Commit**: YES | Message: `perf(platform-fastify): streamline native route handling` | Files: `packages/platform-fastify/src/**`, `.changeset/*.md`

- [x] 5. Optimize DI/runtime plan-cache paths without DI or runtime contract changes

  **What to do**: Improve only proven hot paths: `hasRequestScopedDependency`, provider lookup/multi-provider plan cache, alias/effective-provider resolution, module graph cache. Keep override/dispose invalidation semantics intact. Allowed changes are private cache representation, private internal metadata flow, and runtime-to-platform bootstrap wiring.
  **Must NOT do**: Do not change DI scope semantics, provider override behavior, disposal ordering, public `Container` method behavior, module metadata semantics, or runtime public API. Do not add or broaden caches until focused benchmark evidence shows a repeated lookup/allocation that affects HTTP benchmark routes.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 6 | Blocked By: 2

  **References**:
  - Cache fields: `packages/di/src/container.ts:191` - provider and request-scope plan caches.
  - Hot path: `packages/di/src/container.ts:372` - request-scope dependency verdict.
  - Hot path: `packages/di/src/container.ts:536` - multi-provider collection.
  - Hot path: `packages/di/src/container.ts:637` - provider resolve path.
  - Invalidation: `packages/di/src/container.ts:1035` - lineage revision cache reads/writes.
  - Benchmark: `tooling/benchmarks/di-container/run.mjs:1`
  - Benchmark: `tooling/benchmarks/runtime-module-graph/run.mjs:1`

  **Acceptance Criteria**:
  - [x] Add RED tests first in `packages/di/src/container.test.ts` for the exact cache/invalidation branch being changed.
  - [x] If runtime module graph changes, add RED tests first in `packages/runtime/src/module-graph.test.ts`.
  - [x] Run existing public surface tests for touched packages, including `packages/runtime/src/public-surface.test.ts` when runtime changes.
  - [x] `pnpm exec vitest run packages/di/src/container.test.ts packages/runtime/src/module-graph.test.ts`
  - [x] `BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/di-before-after.json pnpm bench:di-container`
  - [x] `BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/runtime-before-after.json pnpm bench:runtime-module-graph`

  **QA Scenarios**:
  ```text
  Scenario: DI benchmark smoke
    Tool: tmux
    Steps: tmux new-session -d -s ulw-qa-di 'cd /Users/tilda-frontend-jinho/Documents/fluo && BENCH_SMOKE=1 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/task-5-di-smoke.json pnpm bench:di-container'; tmux capture-pane -pt ulw-qa-di -S -200
    Expected: exit 0, output contains DI container focused benchmark, JSON has all scenarios
    Evidence: evidence/fluo-http-performance-nestjs/task-5-di-smoke.txt

  Scenario: runtime module graph benchmark smoke
    Tool: tmux
    Steps: tmux new-session -d -s ulw-qa-runtime 'cd /Users/tilda-frontend-jinho/Documents/fluo && BENCH_SMOKE=1 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/task-5-runtime-smoke.json pnpm bench:runtime-module-graph'; tmux capture-pane -pt ulw-qa-runtime -S -200
    Expected: exit 0, output contains Runtime module graph focused benchmark, JSON has cache-on and cache-off scenarios
    Evidence: evidence/fluo-http-performance-nestjs/task-5-runtime-smoke.txt
  ```

  **Commit**: YES | Message: `perf(di): improve provider plan cache hot paths` | Files: `packages/di/src/**`, optional `packages/runtime/src/**`, `.changeset/*.md`

- [x] 6. Run focused benchmark triage and select only contract-safe optimizations

  **What to do**: Compare before/after evidence from Tasks 3-5. Keep optimizations that improve focused benchmarks without user-facing regression or external contract change. Revert only the implementer's own non-beneficial changes, never unrelated worktree changes.
  **Must NOT do**: Do not keep code that only improves synthetic microbenchmarks while hurting HTTP comparison. Do not keep any change that requires external API/behavior migration.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 7 | Blocked By: 3, 4, 5

  **References**:
  - Benchmark scope: `tooling/benchmarks/http-comparison/README.md:11` - practical workloads.
  - Correctness gates: `tooling/benchmarks/http-comparison/README.md:44` - invalid traffic counters.
  - Report JSON: `tooling/benchmarks/http-comparison/src/run.ts:451` - metric snapshot.
  - Report write: `tooling/benchmarks/http-comparison/src/run.ts:535` - JSON output structure.

  **Acceptance Criteria**:
  - [x] Add or update benchmark comparison parser test first if new parser/tooling is introduced.
  - [x] Produce `evidence/fluo-http-performance-nestjs/triage.md` with keep/drop decision for each optimization.
  - [x] Produce `evidence/fluo-http-performance-nestjs/external-contract-audit.md` listing public exports/types/options/errors/docs reviewed and confirming no external contract change.
  - [x] `pnpm build && pnpm typecheck && pnpm lint && pnpm test`

  **QA Scenarios**:
  ```text
  Scenario: focused benchmark comparison
    Tool: tmux
    Steps: tmux new-session -d -s ulw-qa-focused 'cd /Users/tilda-frontend-jinho/Documents/fluo && node tooling/benchmarks/http-dispatch-hot-path.mjs && node tooling/benchmarks/http-dto-binding-plan.mjs && BENCH_SMOKE=1 pnpm bench:di-container && BENCH_SMOKE=1 pnpm bench:runtime-module-graph'; tmux capture-pane -pt ulw-qa-focused -S -400
    Expected: all commands exit 0 and triage.md records no kept regression
    Evidence: evidence/fluo-http-performance-nestjs/task-6-focused.txt

  Scenario: full tests after triage
    Tool: tmux
    Steps: tmux new-session -d -s ulw-qa-verify 'cd /Users/tilda-frontend-jinho/Documents/fluo && pnpm verify'; tmux capture-pane -pt ulw-qa-verify -S -400
    Expected: pnpm verify exits 0, or pre-existing unrelated failures are documented with exact command output
    Evidence: evidence/fluo-http-performance-nestjs/task-6-verify.txt
  ```

  **Commit**: YES | Message: `perf(runtime): keep measured http hot path wins` | Files: changed source/test/benchmark files

- [x] 7. Prove NestJS comparison result under same environment

  **What to do**: Run final same-environment Fastify benchmark with repeated runs, store JSON and terminal output, compute geometric mean req/sec and latency deltas. Required artifacts: `published-baseline.json`, `local-before.json`, `local-after.json`, and `http-final.json`. If fluo+Fastify is still slower, create a no-go report with top measured bottleneck and next safe target.
  **Must NOT do**: Do not include `fluo+Bun` in the pass/fail claim.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: 8 | Blocked By: 6

  **References**:
  - Existing target labels: `tooling/benchmarks/http-comparison/src/run.ts:56`
  - Scenarios: `tooling/benchmarks/http-comparison/src/run.ts:80`
  - Warmup/measure defaults: `tooling/benchmarks/http-comparison/src/run.ts:113`
  - Rotation: `tooling/benchmarks/http-comparison/src/run.ts:318`
  - JSON averages: `tooling/benchmarks/http-comparison/src/run.ts:496`
  - Environment summary: `tooling/benchmarks/http-comparison/src/run.ts:524`

  **Acceptance Criteria**:
  - [x] `BENCH_TARGETS=nestjs-fastify,fluo-fastify BENCH_FLUO_SOURCE=published BENCH_RUNS=5 BENCH_WARMUP_SEC=10 BENCH_MEASURE_SEC=40 BENCH_CONNECTIONS=100 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/published-baseline.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench`
  - [x] `BENCH_TARGETS=nestjs-fastify,fluo-fastify BENCH_FLUO_SOURCE=local-tarball BENCH_RUNS=5 BENCH_WARMUP_SEC=10 BENCH_MEASURE_SEC=40 BENCH_CONNECTIONS=100 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/http-final.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench`
  - [x] `evidence/fluo-http-performance-nestjs/http-final-summary.md` contains per-scenario req/sec, p50, p97.5, p99, stddev/sample notes, geometric mean, pass/fail, and source labels.
  - [x] All correctness counters are 0.
  - [x] `fluo+Fastify` geometric mean req/sec >= `Nest+Fastify` by 5%, no scenario has `fluo+Fastify` p99 worse than `Nest+Fastify`, or `evidence/fluo-http-performance-nestjs/no-go.md` exists.

  **QA Scenarios**:
  ```text
  Scenario: final same-environment benchmark
    Tool: tmux
    Steps: tmux new-session -d -s ulw-qa-http-final 'cd /Users/tilda-frontend-jinho/Documents/fluo && BENCH_TARGETS=nestjs-fastify,fluo-fastify BENCH_FLUO_SOURCE=local-tarball BENCH_RUNS=5 BENCH_WARMUP_SEC=10 BENCH_MEASURE_SEC=40 BENCH_CONNECTIONS=100 BENCH_OUTPUT_JSON=evidence/fluo-http-performance-nestjs/http-final.json pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace bench'; tmux capture-pane -pt ulw-qa-http-final -S -800
    Expected: exit 0, all counters 0, summary states fluo+Fastify >= Nest+Fastify +5% geometric mean or no-go reason
    Evidence: evidence/fluo-http-performance-nestjs/task-7-http-final.txt

  Scenario: benchmark JSON machine-readable
    Tool: tmux
    Steps: node -e "const r=require('./evidence/fluo-http-performance-nestjs/http-final.json'); if(r.benchmark!=='http-comparison'||!Array.isArray(r.scenarios)) process.exit(1); for (const s of r.scenarios) for (const t of s.targets) if(t.metrics.errors||t.metrics.timeouts||t.metrics.non2xx||t.metrics.mismatches) process.exit(2);"
    Expected: exit 0
    Evidence: evidence/fluo-http-performance-nestjs/task-7-json-check.txt
  ```

  **Commit**: NO | Message: n/a | Files: `evidence/fluo-http-performance-nestjs/**`

- [x] 8. Update changesets, docs scope notes, and release readiness evidence

  **What to do**: Add patch Changesets for every changed public package that received internal performance changes. Update docs only for benchmark instructions or measured-scope notes, not API/behavior migration. Preserve EN/KO parity where docs are touched.
  **Must NOT do**: Do not publish locally. Do not claim global superiority outside the measured benchmark scope. Do not write migration notes for a behavior/API change because such a change is out of scope; if migration notes would be needed, stop and record no-go.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: final verification | Blocked By: 7

  **References**:
  - Policy: `AGENTS.md` - Changesets-only and no local publish.
  - Script: `package.json:41` - release lane verifier.
  - Script: `package.json:42` - release readiness verifier.
  - Contract skill: `.codex/skills/fluo-contract-governance/SKILL.md`
  - Release skill: `.codex/skills/fluo-release-operations/SKILL.md`

  **Acceptance Criteria**:
  - [x] `.changeset/*.md` includes all changed public `@fluojs/*` packages with patch bump for internal performance work only.
  - [x] No `minor` or `major` changeset is present for this work. If semver impact would be `minor` or `major`, no-go instead of implementation.
  - [x] `pnpm verify:changeset-release-lane -- --lane=stable --base-ref=main`
  - [x] `pnpm verify:release-readiness`
  - [x] If docs touched: `pnpm verify:docs`

  **QA Scenarios**:
  ```text
  Scenario: release metadata gate
    Tool: tmux
    Steps: tmux new-session -d -s ulw-qa-release 'cd /Users/tilda-frontend-jinho/Documents/fluo && pnpm verify:changeset-release-lane -- --lane=stable --base-ref=main && pnpm verify:release-readiness'; tmux capture-pane -pt ulw-qa-release -S -300
    Expected: both commands exit 0
    Evidence: evidence/fluo-http-performance-nestjs/task-8-release.txt

  Scenario: docs parity if touched
    Tool: tmux
    Steps: If docs/book/README locale files changed, run `pnpm verify:docs`; otherwise record "not applicable - no docs changed"
    Expected: verify:docs exits 0 when applicable
    Evidence: evidence/fluo-http-performance-nestjs/task-8-docs.txt
  ```

  **Commit**: YES | Message: `docs(benchmarks): document measured http performance scope` | Files: `.changeset/*.md`, optional docs/README files

## Final Verification Wave
> ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing merge/publish side effects.
- [x] F1. Plan Compliance Audit: verify every task has RED->GREEN evidence, QA artifact, and no pending steps.
- [x] F2. Code Quality Review: run a read-only reviewer over changed files for type safety, contract preservation, no broad rewrites, no `as any`.
- [x] F3. Real Manual QA: rerun Task 7 final benchmark and at least one `curl -i` route check.
- [x] F4. Scope Fidelity Check: confirm final claim is only about measured same-environment Fastify workloads.
- [x] F5. External Contract Audit: confirm no public exports/import paths/types/options/error semantics/documented behavior changed; if any did, reject and convert to no-go.

## Commit Strategy
- Commit after each logical wave only after build/test gates for that wave pass.
- Conventional commit format.
- No `Co-Authored-By`.
- No automatic merge or local publish.

## Success Criteria
- Benchmark lane supports same-environment Fastify-only local tarball comparison.
- fluo fast-path/native route use is observable in benchmark routes.
- External-contract-preserving hot-path optimizations are backed by tests, public-surface guards, and focused benchmarks.
- Final same-environment HTTP benchmark evidence is captured.
- Public package internal performance changes include patch Changesets and release readiness evidence.
