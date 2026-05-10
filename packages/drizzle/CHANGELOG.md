# @fluojs/drizzle

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
