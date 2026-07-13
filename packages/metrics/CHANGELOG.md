# @fluojs/metrics

## [Unreleased]

### Patch Changes

- No pending runtime changes.

## 2.0.0

### Major Changes

- [#2377](https://github.com/fluojs/fluo/pull/2377) [`8cb5ef0`](https://github.com/fluojs/fluo/commit/8cb5ef0c409abc6757593c3a6e00463ffb93cde2) Thanks [@ayden94](https://github.com/ayden94)! - Validate shared-registry HTTP collector path-label configuration before reuse and keep platform telemetry stale-series ownership scoped to the reused registry.

  Migration note: applications that pass the same Prometheus registry to multiple `MetricsModule.forRoot(...)` calls must now use matching HTTP path-label configuration for framework-owned collectors. Align `pathLabelMode`, reuse the same `pathLabelNormalizer` function reference when a custom normalizer is configured, and keep `unknownPathLabel` consistent across module instances before sharing a registry. If different HTTP path-label policies are required, use separate registries for those module instances.

### Patch Changes

- [#2464](https://github.com/fluojs/fluo/pull/2464) [`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439) Thanks [@ayden94](https://github.com/ayden94)! - Refresh runtime platform telemetry from the active registry collect path so advanced shared-registry scrapers observe fresh component readiness and health series.

- [#2337](https://github.com/fluojs/fluo/pull/2337) [`3dc00db`](https://github.com/fluojs/fluo/commit/3dc00db1b56554d153df5742a81ee67a5a73fc31) Thanks [@ayden94](https://github.com/ayden94)! - Harden platform telemetry scrapes so missing platform-shell registration uses container presence checks, registered shell resolution failures still surface, and component ids or kinds containing separator-like text keep distinct Prometheus series.

- [#2691](https://github.com/fluojs/fluo/pull/2691) [`e43c3ac`](https://github.com/fluojs/fluo/commit/e43c3ac9c7682ab18a94631ea91b6ba799c525d2) Thanks [@ayden94](https://github.com/ayden94)! - Release shared Registry telemetry scrape wrappers on application shutdown and restore the original `metrics()` function after the last metrics module closes.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/http@2.0.0
  - @fluojs/core@1.1.0

## 1.0.4

### Patch Changes

- [#2159](https://github.com/fluojs/fluo/pull/2159) [`c57e4d0`](https://github.com/fluojs/fluo/commit/c57e4d0106cb1d9ac061f7d36f86d17d5da2bda9) Thanks [@ayden94](https://github.com/ayden94)! - Harden metrics lifecycle ownership so isolated registries, services, meter providers, and platform telemetry are created at application bootstrap boundaries instead of dynamic module definition time, while preserving shared-registry scrape collision guards.

- [#2114](https://github.com/fluojs/fluo/pull/2114) [`23eeea1`](https://github.com/fluojs/fluo/commit/23eeea1c0276e8dd9696215f5be35bbd67c7ad06) Thanks [@ayden94](https://github.com/ayden94)! - Ensure `endpointMiddleware` remains bound when `MetricsModule.forRoot({ path: '' })` exposes an empty-string metrics endpoint.

- Updated dependencies [[`5d8fc23`](https://github.com/fluojs/fluo/commit/5d8fc23b199d4b617c6342f109c24e03970af9b4), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/http@1.1.2
  - @fluojs/runtime@1.1.8

## 1.0.3

### Patch Changes

- [#1993](https://github.com/fluojs/fluo/pull/1993) [`d27a381`](https://github.com/fluojs/fluo/commit/d27a3810f7a0053ff490c21564f419af9f80e33f) Thanks [@ayden94](https://github.com/ayden94)! - Align Terminus Redis diagnostics and Metrics option responsibility contracts with lifecycle-aware tests, public documentation, and TSDoc coverage.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/http@1.1.0

## 1.0.2

### Patch Changes

- [#1865](https://github.com/fluojs/fluo/pull/1865) [`d7f03ff`](https://github.com/fluojs/fluo/commit/d7f03ff4de383bfa322ef6bac958fb9970949ca0) Thanks [@ayden94](https://github.com/ayden94)! - Record metrics endpoint middleware failures in built-in HTTP instrumentation and validate framework-owned HTTP collector label schemas before shared-registry reuse.

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2)]:
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0

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
