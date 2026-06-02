## Problem

The repository needs same-environment HTTP benchmark evidence for `Nest+Fastify` versus `fluo+Fastify`, plus contract-safe hot-path optimizations where the benchmark exposes avoidable overhead.

Previous benchmark comparisons could not cleanly prove whether the fluo target was using local package changes, whether traffic correctness counters stayed clean, or whether benchmark routes actually exercised the intended native/fast path.

## Scope

- Add a local-tarball benchmark lane so benchmark runs can compare published packages and the current worktree under the same Node/Fastify environment.
- Add target/scenario filtering and JSON evidence output for the HTTP comparison benchmark.
- Expose fast-path stats that can prove route execution path and fallback reasons.
- Optimize only contract-safe internal hot paths:
  - HTTP dispatcher fast-path execution;
  - Fastify native route request handling;
  - DI singleton multi-provider resolution.
- Preserve public API/import paths/options/error semantics.
- Add patch changesets for affected public `@fluojs/*` packages.
- Record a no-go result if final same-environment benchmark evidence does not meet the target.

## Acceptance Criteria

- Same-environment `nestjs-fastify` and `fluo-fastify` benchmark evidence is captured with `BENCH_FLUO_SOURCE=local-tarball`.
- Benchmark correctness counters are machine-checkable and remain zero for final runs.
- Route fast-path/native-route use is observable in benchmark/debug evidence.
- Contract fallback behavior remains covered for multipart, raw-body, normalization-sensitive paths, and params containing `/`.
- Public export maps and documented behavior are not changed.
- Full verification and release-readiness gates pass.
- If the target is missed, the PR records no-go evidence rather than claiming a performance win.
