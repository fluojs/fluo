# @fluojs/drizzle

## [Unreleased]

## 2.0.0

### Major Changes

- [#2776](https://github.com/fluojs/fluo/pull/2776) [`edf4092`](https://github.com/fluojs/fluo/commit/edf4092030e434ca306735953298d81808b69995) Thanks [@ayden94](https://github.com/ayden94)! - Require Drizzle ORM 0.45.2 or newer. Consumers using an older Drizzle ORM release must upgrade the peer, refresh their lockfile, and run driver-specific query and migration tests before adopting this release; the fluo integration API is unchanged.

### Patch Changes

- Updated dependencies [[`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4)]:
  - @fluojs/runtime@2.0.2

## 1.1.1

### Patch Changes

- [#2383](https://github.com/fluojs/fluo/pull/2383) [`ad46594`](https://github.com/fluojs/fluo/commit/ad46594d68ad1c25721d421e2c81fc6b17496b4a) Thanks [@ayden94](https://github.com/ayden94)! - Bind Drizzle facade lifecycle methods to the lifecycle owner so shutdown and status snapshots read the same live state, and align transaction target-resolution docs with the implemented fallback order.

- [#2338](https://github.com/fluojs/fluo/pull/2338) [`98b53c5`](https://github.com/fluojs/fluo/commit/98b53c5bf73b9a36256a0932523950c02724f201) Thanks [@ayden94](https://github.com/ayden94)! - Track fail-open manual transaction callbacks during shutdown so `dispose(database)` waits for direct-execution fallbacks to settle before closing application-owned Drizzle resources.

- [#2469](https://github.com/fluojs/fluo/pull/2469) [`a93c5c7`](https://github.com/fluojs/fluo/commit/a93c5c77f7ae9bc84f019c5a86d13299e80415c2) Thanks [@ayden94](https://github.com/ayden94)! - Align the public Drizzle handle provider type with its documented platform status snapshot contract and add regression coverage for Drizzle transaction target resolution and facade forwarding.

- [#2674](https://github.com/fluojs/fluo/pull/2674) [`71d83f1`](https://github.com/fluojs/fluo/commit/71d83f13c4264ceeaaba05111eb9e3f33c5ce371) Thanks [@ayden94](https://github.com/ayden94)! - Restore the governed `Unreleased` changelog placeholder for persistence packages and preserve it when Changesets generates future package versions.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/core@1.1.0

## 1.1.0

### Minor Changes

- [#2089](https://github.com/fluojs/fluo/pull/2089) [`b790a67`](https://github.com/fluojs/fluo/commit/b790a67a80236518bb625e860656c0e934973dcf) Thanks [@ayden94](https://github.com/ayden94)! - Add the Drizzle service `Transaction` decorator and current-less database facade.

  Remove the previously exported `DrizzleTransactionInterceptor`; use `@Transaction()` or explicit `requestTransaction()` boundaries instead.

### Patch Changes

- [#2118](https://github.com/fluojs/fluo/pull/2118) [`d655c6c`](https://github.com/fluojs/fluo/commit/d655c6c35a55da70d723231e3436e54f4d707cfc) Thanks [@ayden94](https://github.com/ayden94)! - Align the Drizzle direct-method facade type and documentation, classify `DrizzleDatabase.createFacade(...)` as a low-level compatibility helper, and remove the stale `@fluojs/http` runtime dependency.

- [#2158](https://github.com/fluojs/fluo/pull/2158) [`c4d0852`](https://github.com/fluojs/fluo/commit/c4d08520ccbdaa356d1eb244fd7b9b8d0a1f6e2d) Thanks [@ayden94](https://github.com/ayden94)! - Reject nested Drizzle transaction calls once application shutdown begins so ambient transaction reuse cannot bypass the documented shutdown boundary.

- Updated dependencies [[`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/runtime@1.1.8

## 1.0.2

### Patch Changes

- [#2008](https://github.com/fluojs/fluo/pull/2008) [`225759e`](https://github.com/fluojs/fluo/commit/225759e3103d0e7581ceec93694980623c037a78) Thanks [@ayden94](https://github.com/ayden94)! - Tighten persistence module registration input validation and document strict transaction handling for Mongoose connection-level transaction boundaries.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b)]:
  - @fluojs/runtime@1.1.2

## 1.0.1

### Patch Changes

- [#1986](https://github.com/fluojs/fluo/pull/1986) [`778e748`](https://github.com/fluojs/fluo/commit/778e748b30ff272a3b9d013f71f0e807c4563b57) Thanks [@ayden94](https://github.com/ayden94)! - Isolate async Drizzle module factory results per application container and drain open manual transaction boundaries before disposal during shutdown.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/http@1.1.0

## 1.0.0

### Minor Changes

- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- c5521e0: Keep nested request transactions linked to ambient request abort signals and report completed nested request callbacks as inactive even while an outer manual transaction continues.
- 3465437: Track nested request transactions opened inside manual Drizzle transaction boundaries during shutdown so they abort and drain before disposal.
- d9bff54: Reject late request transactions after Drizzle shutdown begins and preserve request abort errors until the active Drizzle transaction lifecycle settles, so commit/rollback cleanup is not interrupted before the caller sees the abort reason.
- 00f4d90: Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

- d3504c6: Make Terminus Drizzle health checks lifecycle-aware by resolving the public Drizzle wrapper token before raw ping fallback, so shutdown and stopped Drizzle integrations now report unavailable health/readiness.

  Expose the `/ready` request context to runtime health readiness checks so integrations can resolve public runtime status providers without importing runtime internals.

- Updated dependencies [01d5e65]
- Updated dependencies [4fdb48c]
- Updated dependencies [72462e3]
- Updated dependencies [da003a1]
- Updated dependencies [c5aebdf]
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
- Updated dependencies [aaab8c4]
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
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/di@1.0.0

## 1.0.0-beta.5

### Patch Changes

- [#1823](https://github.com/fluojs/fluo/pull/1823) [`c5521e0`](https://github.com/fluojs/fluo/commit/c5521e0c2d9fc7070126f5e857cf6bb2cf7b9579) Thanks [@ayden94](https://github.com/ayden94)! - Keep nested request transactions linked to ambient request abort signals and report completed nested request callbacks as inactive even while an outer manual transaction continues.

- Updated dependencies [[`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157), [`45e0f1b`](https://github.com/fluojs/fluo/commit/45e0f1bf877ba69544d93094d9c54657ea941e74), [`7b50db8`](https://github.com/fluojs/fluo/commit/7b50db85e95e2341f82d006f1e665c2bbcebeaa5)]:
  - @fluojs/core@1.0.0-beta.6
  - @fluojs/di@1.0.0-beta.8
  - @fluojs/http@1.0.0-beta.11

## 1.0.0-beta.4

### Patch Changes

- [#1690](https://github.com/fluojs/fluo/pull/1690) [`3465437`](https://github.com/fluojs/fluo/commit/3465437399e8e6ecdfca68fa8f5ccb02d5a9c52f) Thanks [@ayden94](https://github.com/ayden94)! - Track nested request transactions opened inside manual Drizzle transaction boundaries during shutdown so they abort and drain before disposal.

- [#1622](https://github.com/fluojs/fluo/pull/1622) [`d9bff54`](https://github.com/fluojs/fluo/commit/d9bff543e337eaa7654fae5e25dcaef2784fa8d1) Thanks [@ayden94](https://github.com/ayden94)! - Reject late request transactions after Drizzle shutdown begins and preserve request abort errors until the active Drizzle transaction lifecycle settles, so commit/rollback cleanup is not interrupted before the caller sees the abort reason.

- [#1704](https://github.com/fluojs/fluo/pull/1704) [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f) Thanks [@ayden94](https://github.com/ayden94)! - Make Terminus Drizzle health checks lifecycle-aware by resolving the public Drizzle wrapper token before raw ping fallback, so shutdown and stopped Drizzle integrations now report unavailable health/readiness.

  Expose the `/ready` request context to runtime health readiness checks so integrations can resolve public runtime status providers without importing runtime internals.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.3

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

## 1.0.0-beta.2

### Patch Changes

- [#1349](https://github.com/fluojs/fluo/pull/1349) [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a) Thanks [@ayden94](https://github.com/ayden94)! - Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
