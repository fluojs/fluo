# @fluojs/metrics

## 1.0.2

### Patch Changes

- [#1865](https://github.com/fluojs/fluo/pull/1865) [`d7f03ff`](https://github.com/fluojs/fluo/commit/d7f03ff4de383bfa322ef6bac958fb9970949ca0) Thanks [@ayden94](https://github.com/ayden94)! - Record metrics endpoint middleware failures in built-in HTTP instrumentation and validate framework-owned HTTP collector label schemas before shared-registry reuse.

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2)]:
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.0.1

## 1.0.0

### Patch Changes

- 616189f: Clear stale runtime platform telemetry series when `PLATFORM_SHELL` becomes unavailable after a prior scrape, and align the documented metrics public surface with exported contracts.
- 2513723: Reuse built-in HTTP metrics when multiple MetricsModule instances intentionally share one registry, while documenting that HTTP instrumentation requires the explicit `http` option.
- e55065e: Reject app-owned platform telemetry gauge name collisions in shared registries and reuse only framework-owned gauges with the expected label schema.
- Updated dependencies [01d5e65]
- Updated dependencies [4fdb48c]
- Updated dependencies [72462e3]
- Updated dependencies [da003a1]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [1d43614]
- Updated dependencies [2159d4f]
- Updated dependencies [f086fa5]
- Updated dependencies [288a0b1]
- Updated dependencies [33d51e1]
- Updated dependencies [1dda8b5]
- Updated dependencies [3f70169]
- Updated dependencies [1911e11]
- Updated dependencies [1b0a68a]
- Updated dependencies [93fc34b]
- Updated dependencies [a625716]
- Updated dependencies [45e0f1b]
- Updated dependencies [b82b28f]
- Updated dependencies [37ae1c5]
- Updated dependencies [48a9f97]
- Updated dependencies [16420f9]
- Updated dependencies [53a2b8e]
- Updated dependencies [e1bce3d]
- Updated dependencies [3baf5df]
- Updated dependencies [7b50db8]
- Updated dependencies [005d3d7]
- Updated dependencies [f8d05fa]
- Updated dependencies [b74832f]
- Updated dependencies [4333cee]
- Updated dependencies [f28a8c8]
- Updated dependencies [6b8e8a9]
- Updated dependencies [89f6379]
- Updated dependencies [f0dce1f]
- Updated dependencies [c509e27]
- Updated dependencies [c3ef937]
- Updated dependencies [69936b1]
- Updated dependencies [35f60fd]
- Updated dependencies [28ca2ef]
- Updated dependencies [d3504c6]
  - @fluojs/http@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/di@1.0.0

## 1.0.0-beta.4

### Patch Changes

- [#1624](https://github.com/fluojs/fluo/pull/1624) [`e55065e`](https://github.com/fluojs/fluo/commit/e55065e0a563f778b5227dadd6f7d1a4a12a2ee6) Thanks [@ayden94](https://github.com/ayden94)! - Reject app-owned platform telemetry gauge name collisions in shared registries and reuse only framework-owned gauges with the expected label schema.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.3

### Patch Changes

- [#1509](https://github.com/fluojs/fluo/pull/1509) [`2513723`](https://github.com/fluojs/fluo/commit/2513723dfe09ebbc4018104f5461c8f1fcd28920) Thanks [@ayden94](https://github.com/ayden94)! - Reuse built-in HTTP metrics when multiple MetricsModule instances intentionally share one registry, while documenting that HTTP instrumentation requires the explicit `http` option.

- Updated dependencies [[`1d43614`](https://github.com/fluojs/fluo/commit/1d4361416e56ec935d67da096ba8b72d3886f7ee), [`f086fa5`](https://github.com/fluojs/fluo/commit/f086fa58827617bda8bdef50e0b694bd5e85dfaa), [`f8d05fa`](https://github.com/fluojs/fluo/commit/f8d05fac610bd5a58c27f84e764338ee718c0a67), [`6b8e8a9`](https://github.com/fluojs/fluo/commit/6b8e8a9d2c6123d9a1ca2ec805ef4fde97d1f199)]:
  - @fluojs/di@1.0.0-beta.6
  - @fluojs/runtime@1.0.0-beta.9

## 1.0.0-beta.2

### Patch Changes

- [#1366](https://github.com/fluojs/fluo/pull/1366) [`616189f`](https://github.com/fluojs/fluo/commit/616189ff76227bf574226ecd32134584e193efdc) Thanks [@ayden94](https://github.com/ayden94)! - Clear stale runtime platform telemetry series when `PLATFORM_SHELL` becomes unavailable after a prior scrape, and align the documented metrics public surface with exported contracts.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
