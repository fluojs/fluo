# @fluojs/mongoose

## [Unreleased]

## 1.1.1

### Patch Changes

- [#2663](https://github.com/fluojs/fluo/pull/2663) [`f358fef`](https://github.com/fluojs/fluo/commit/f358feff29b9ca440b2d83e7b6b141bfd478265c) Thanks [@ayden94](https://github.com/ayden94)! - Keep aborted request callbacks tracked through session and connection cleanup, forward positional `create()` documents without appending session options, and expose consumer-specializable model facade result types.

- [#2466](https://github.com/fluojs/fluo/pull/2466) [`388f4e7`](https://github.com/fluojs/fluo/commit/388f4e7a5d657364fe10c063c36d3e10dd962b71) Thanks [@ayden94](https://github.com/ayden94)! - Track fail-open manual `transaction(...)` callbacks during shutdown so `dispose(connection)` waits for direct execution to settle before closing application-owned resources.

- [#2341](https://github.com/fluojs/fluo/pull/2341) [`c9af8cf`](https://github.com/fluojs/fluo/commit/c9af8cf63cb0a2a2e9897b39cc508ad81ee0a759) Thanks [@ayden94](https://github.com/ayden94)! - Preserve nested request transaction tracking for ambient manual Mongoose transactions and avoid false session-conflict errors for projection/document fields named `session`.

- [#2674](https://github.com/fluojs/fluo/pull/2674) [`71d83f1`](https://github.com/fluojs/fluo/commit/71d83f13c4264ceeaaba05111eb9e3f33c5ce371) Thanks [@ayden94](https://github.com/ayden94)! - Restore the governed `Unreleased` changelog placeholder for persistence packages and preserve it when Changesets generates future package versions.

- [#2659](https://github.com/fluojs/fluo/pull/2659) [`4781600`](https://github.com/fluojs/fluo/commit/47816000b85ac0c1c817ed2783736c5eed8387d2) Thanks [@ayden94](https://github.com/ayden94)! - Restore the deprecated Prisma and Mongoose transaction interceptor exports for 1.x compatibility while keeping service transactions and explicit request boundaries as the preferred migration path.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/http@2.0.0
  - @fluojs/core@1.1.0

## 1.1.0

### Minor Changes

- [#2089](https://github.com/fluojs/fluo/pull/2089) [`e1ad29d`](https://github.com/fluojs/fluo/commit/e1ad29dfe7b5d976da852d652a9861ce8248aa7e) Thanks [@ayden94](https://github.com/ayden94)! - Add a Mongoose service `Transaction` decorator and conservative model auto-session facade.

  Remove the previously exported `MongooseTransactionInterceptor`; use `@Transaction()` or explicit `requestTransaction()` boundaries instead.

### Patch Changes

- [#2115](https://github.com/fluojs/fluo/pull/2115) [`08b07de`](https://github.com/fluojs/fluo/commit/08b07de6c5d93af078e1cf6f310e5f8049f53107) Thanks [@ayden94](https://github.com/ayden94)! - Fix Mongoose transaction shutdown ordering and model facade ownership so shutdown is checked before ambient manual transaction reuse, automatic model session injection stays scoped to `MongooseConnection.model(...)`, and raw Mongoose connection objects are not mutated.

- Updated dependencies [[`5d8fc23`](https://github.com/fluojs/fluo/commit/5d8fc23b199d4b617c6342f109c24e03970af9b4), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/http@1.1.2
  - @fluojs/runtime@1.1.8

## 1.0.5

### Patch Changes

- [#2008](https://github.com/fluojs/fluo/pull/2008) [`225759e`](https://github.com/fluojs/fluo/commit/225759e3103d0e7581ceec93694980623c037a78) Thanks [@ayden94](https://github.com/ayden94)! - Tighten persistence module registration input validation and document strict transaction handling for Mongoose connection-level transaction boundaries.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b)]:
  - @fluojs/runtime@1.1.2

## 1.0.4

### Patch Changes

- [#1995](https://github.com/fluojs/fluo/pull/1995) [`7c65940`](https://github.com/fluojs/fluo/commit/7c659407460caff40b4b3868a9f58c6d425ea1b6) Thanks [@ayden94](https://github.com/ayden94)! - Track nested Mongoose request transaction boundaries during manual transactions and isolate async module factory results per application container.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/http@1.1.0

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
