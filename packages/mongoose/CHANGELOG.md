# @fluojs/mongoose

## 1.0.3

### Patch Changes

- [#1927](https://github.com/fluojs/fluo/pull/1927) [`705f5df`](https://github.com/fluojs/fluo/commit/705f5df2b54f0318aaeedfa34c759d21392a082b) Thanks [@ayden94](https://github.com/ayden94)! - Export the documented async module options and platform status snapshot input types, and clarify that `createMongooseProviders(...)` is reserved for manual composition compatibility while `MongooseModule.forRoot(...)` / `forRootAsync(...)` remain the primary registration APIs.

## 1.0.1

### Patch Changes

- [#1841](https://github.com/fluojs/fluo/pull/1841) [`673c98f`](https://github.com/fluojs/fluo/commit/673c98f2f9b653fca4804f2dfe5f73e28c0feb12) Thanks [@ayden94](https://github.com/ayden94)! - Race Mongoose request transaction session acquisition and delegated `connection.transaction(...)` startup against request aborts, and reject new manual/request transaction boundaries once application shutdown begins.

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.1

## 1.0.0

### Minor Changes

- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- adb52ec: Preserve Mongoose connection.transaction ambient session scope while tracking active sessions through shutdown so dispose hooks wait for transaction cleanup.
- 6280186: Document and preserve Mongoose request transaction shutdown lifecycle guarantees, including session cleanup before dispose and lifecycle status reporting while transactions drain.
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

## 1.0.0-beta.4

### Patch Changes

- [#1634](https://github.com/fluojs/fluo/pull/1634) [`adb52ec`](https://github.com/fluojs/fluo/commit/adb52ec6bb684b87da9656f9cc8f3de208ff4ec9) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Mongoose connection.transaction ambient session scope while tracking active sessions through shutdown so dispose hooks wait for transaction cleanup.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.3

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

## 1.0.0-beta.2

### Patch Changes

- [#1355](https://github.com/fluojs/fluo/pull/1355) [`6280186`](https://github.com/fluojs/fluo/commit/6280186a965bbfec4b83bfb3c9445726a32e7d15) Thanks [@ayden94](https://github.com/ayden94)! - Document and preserve Mongoose request transaction shutdown lifecycle guarantees, including session cleanup before dispose and lifecycle status reporting while transactions drain.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
