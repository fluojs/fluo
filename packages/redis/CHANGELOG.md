# @fluojs/redis

## [Unreleased]

## 1.1.0

### Minor Changes

- [#2627](https://github.com/fluojs/fluo/pull/2627) [`9d70d61`](https://github.com/fluojs/fluo/commit/9d70d610dc447ac088533bcb7428af0b92bd6a7d) Thanks [@ayden94](https://github.com/ayden94)! - Add `sentinelName` so ioredis Sentinel master names remain independent from Fluo named Redis registrations.

### Patch Changes

- [#2607](https://github.com/fluojs/fluo/pull/2607) [`2190cbf`](https://github.com/fluojs/fluo/commit/2190cbf926309e6d9c40d173fa8fe7a9a23685be) Thanks [@ayden94](https://github.com/ayden94)! - Close lifecycle-owned Redis clients that are in monitoring mode during application shutdown.

- [#2633](https://github.com/fluojs/fluo/pull/2633) [`6602fe0`](https://github.com/fluojs/fluo/commit/6602fe03d35dd2ba56669977d4d3af9deec96b21) Thanks [@ayden94](https://github.com/ayden94)! - Normalize fractional RedisService TTLs to integer millisecond expiry values.

- [#2631](https://github.com/fluojs/fluo/pull/2631) [`f31435d`](https://github.com/fluojs/fluo/commit/f31435d980dca14051b462d3ad1940b94c994d52) Thanks [@ayden94](https://github.com/ayden94)! - Close Redis connections that complete after the lifecycle connect timeout.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/core@1.1.0

## 1.0.2

### Patch Changes

- [#2232](https://github.com/fluojs/fluo/pull/2232) [`050620e`](https://github.com/fluojs/fluo/commit/050620e22d83ccd45c35bf091a813e7445bb74ed) Thanks [@ayden94](https://github.com/ayden94)! - Harden Redis lifecycle timeout validation and shutdown fallback handling so invalid timeout values fail fast and disconnect fallback only rethrows when the client remains open.

- Updated dependencies [[`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/runtime@1.1.8

## 1.0.1

### Patch Changes

- [#2029](https://github.com/fluojs/fluo/pull/2029) [`b80fa9e`](https://github.com/fluojs/fluo/commit/b80fa9e22414cd7c6f55903fd999707109695017) Thanks [@ayden94](https://github.com/ayden94)! - Disconnect lifecycle-owned Redis clients when bootstrap `connect()` times out so in-flight connection attempts are cleaned up before startup failure propagates, and document the exported default and named Redis module option types in the package README API lists.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b)]:
  - @fluojs/runtime@1.1.2

## 1.0.0

### Minor Changes

- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- 00f4d90: Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

- f1a94b2: Declare `ioredis` as an explicit peer driver for `@fluojs/redis` while preserving the documented install command and runtime behavior.
- ea86ded: Bound lifecycle-owned Redis `connect()` and `quit()` calls with configurable timeouts, document dedicated Pub/Sub subscriber connections, and preserve command error propagation through regression coverage.
- Updated dependencies [4fdb48c]
- Updated dependencies [da003a1]
- Updated dependencies [c5aebdf]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [1d43614]
- Updated dependencies [2159d4f]
- Updated dependencies [f086fa5]
- Updated dependencies [288a0b1]
- Updated dependencies [33d51e1]
- Updated dependencies [1911e11]
- Updated dependencies [1b0a68a]
- Updated dependencies [aaab8c4]
- Updated dependencies [93fc34b]
- Updated dependencies [37ae1c5]
- Updated dependencies [48a9f97]
- Updated dependencies [53a2b8e]
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
- Updated dependencies [d3504c6]
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/di@1.0.0

## 1.0.0-beta.5

### Patch Changes

- [#1819](https://github.com/fluojs/fluo/pull/1819) [`ea86ded`](https://github.com/fluojs/fluo/commit/ea86dedcbfcd7e217e43de1b6e0c3eb588fc4314) Thanks [@ayden94](https://github.com/ayden94)! - Bound lifecycle-owned Redis `connect()` and `quit()` calls with configurable timeouts, document dedicated Pub/Sub subscriber connections, and preserve command error propagation through regression coverage.

- Updated dependencies [[`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157)]:
  - @fluojs/core@1.0.0-beta.6
  - @fluojs/di@1.0.0-beta.8

## 1.0.0-beta.4

### Patch Changes

- [#1654](https://github.com/fluojs/fluo/pull/1654) [`f1a94b2`](https://github.com/fluojs/fluo/commit/f1a94b2e184c8f4507294a826676d36b218a5bbb) Thanks [@ayden94](https://github.com/ayden94)! - Declare `ioredis` as an explicit peer driver for `@fluojs/redis` while preserving the documented install command and runtime behavior.

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
