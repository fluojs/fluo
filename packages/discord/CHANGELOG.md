# @fluojs/discord

## [Unreleased]

## 1.0.5

### Patch Changes

- [#2312](https://github.com/fluojs/fluo/pull/2312) [`3d3789c`](https://github.com/fluojs/fluo/commit/3d3789c12ca994b039367d5c7175be1434e22932) Thanks [@ayden94](https://github.com/ayden94)! - Distinguish Discord bootstrap initialization failures from shutdown cleanup failures in readiness and lifecycle diagnostics.

- [#2652](https://github.com/fluojs/fluo/pull/2652) [`23fd601`](https://github.com/fluojs/fluo/commit/23fd60128f34c221951653e83cc5c87d94acf342) Thanks [@ayden94](https://github.com/ayden94)! - Close factory-owned transports after failed verification, gate renderers by lifecycle, propagate render cancellation, and abort webhook retry waits promptly.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a1dcd40`](https://github.com/fluojs/fluo/commit/a1dcd401e72c1a9b15400c0e55b578bb48a32d3b), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/core@1.1.0
  - @fluojs/notifications@1.0.3

## 1.0.4

### Patch Changes

- [#2263](https://github.com/fluojs/fluo/pull/2263) [`82d0498`](https://github.com/fluojs/fluo/commit/82d0498672428b99318e38fca69a1b4e7eaaeb86) Thanks [@ayden94](https://github.com/ayden94)! - Serialize Discord startup and shutdown transport lifecycle transitions so shutdown drains in-flight factory-owned transport creation and closes owned resources exactly once.

- Updated dependencies [[`78a7ade`](https://github.com/fluojs/fluo/commit/78a7adea4a6dc5e5996af6ca1244c789dab377af), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/notifications@1.0.2
  - @fluojs/runtime@1.1.8

## 1.0.3

### Patch Changes

- [#1983](https://github.com/fluojs/fluo/pull/1983) [`e0c855e`](https://github.com/fluojs/fluo/commit/e0c855eee03d8b59e19420ea1c22ee73ef66fe44) Thanks [@ayden94](https://github.com/ayden94)! - Align notification provider delivery semantics by closing owned email transports when bootstrap verification fails, documenting Slack abort/retry handling and Discord direct batch fan-out boundaries, and strengthening notification dependency diagnostics coverage.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`e0c855e`](https://github.com/fluojs/fluo/commit/e0c855eee03d8b59e19420ea1c22ee73ef66fe44)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/notifications@1.0.1

## 1.0.2

### Major Changes

- [#1867](https://github.com/fluojs/fluo/pull/1867) [`8afb45e`](https://github.com/fluojs/fluo/commit/8afb45ee9a8cbaa21a611079768196e6be0df801) Thanks [@ayden94](https://github.com/ayden94)! - Reject Discord sends until module bootstrap marks the transport ready, preserve failed-bootstrap readiness failures, and allow documented poll-only notification payloads while keeping webhook response exposure documented.

### Patch Changes

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.1

## 1.0.0

### Minor Changes

- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- da7264d: Stop retrying permanent Discord webhook failures and reject sends once the Discord service is shutting down or stopped.
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
- Updated dependencies [3785a42]
- Updated dependencies [1911e11]
- Updated dependencies [1b0a68a]
- Updated dependencies [aaab8c4]
- Updated dependencies [93fc34b]
- Updated dependencies [37ae1c5]
- Updated dependencies [48a9f97]
- Updated dependencies [53a2b8e]
- Updated dependencies [005d3d7]
- Updated dependencies [f8d05fa]
- Updated dependencies [8fb13ad]
- Updated dependencies [512bfd7]
- Updated dependencies [00f4d90]
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
- Updated dependencies [dc8fff1]
- Updated dependencies [d3504c6]
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/di@1.0.0
  - @fluojs/notifications@1.0.0

## 1.0.0-beta.3

### Patch Changes

- [#1651](https://github.com/fluojs/fluo/pull/1651) [`da7264d`](https://github.com/fluojs/fluo/commit/da7264d9592d17354a7ffe993f72973fee9fdede) Thanks [@ayden94](https://github.com/ayden94)! - Stop retrying permanent Discord webhook failures and reject sends once the Discord service is shutting down or stopped.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`3785a42`](https://github.com/fluojs/fluo/commit/3785a42a2206104fe3f799394446fd99ef9fb7d2), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`8fb13ad`](https://github.com/fluojs/fluo/commit/8fb13ad86cdb78d4a7a0316c68aa75d6b317b69a), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/notifications@1.0.0-beta.4
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.2

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- Updated dependencies [[`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299)]:
  - @fluojs/notifications@1.0.0-beta.3
