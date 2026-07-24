# @fluojs/microservices

## [Unreleased]

## 2.0.0

### Major Changes

- [#2776](https://github.com/fluojs/fluo/pull/2776) [`edf4092`](https://github.com/fluojs/fluo/commit/edf4092030e434ca306735953298d81808b69995) Thanks [@ayden94](https://github.com/ayden94)! - Require `@grpc/grpc-js` 1.14.4 or newer for the optional gRPC transport. Upgrade the peer and refresh consumer lockfiles so the proto-loader chain resolves `protobufjs` 7.6.5 or newer; the fluo transport API is unchanged.

### Patch Changes

- Updated dependencies [[`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4)]:
  - @fluojs/runtime@2.0.2

## 1.0.5

### Patch Changes

- [#2703](https://github.com/fluojs/fluo/pull/2703) [`b829e8c`](https://github.com/fluojs/fluo/commit/b829e8c13444eb998938d9c9d70281c2d32948a5) Thanks [@ayden94](https://github.com/ayden94)! - Await Kafka and RabbitMQ inbound handlers and response publication from consumer callbacks so processing failures remain visible to broker acknowledgement and retry paths.

- [#2706](https://github.com/fluojs/fluo/pull/2706) [`f0e004b`](https://github.com/fluojs/fluo/commit/f0e004b97e634f839027623058e69aa11c900267) Thanks [@ayden94](https://github.com/ayden94)! - Clean up NATS subscriptions created by a failed listen attempt without closing the caller-owned client.

- [#2482](https://github.com/fluojs/fluo/pull/2482) [`34ca080`](https://github.com/fluojs/fluo/commit/34ca080549e2bf9fcf44fabf2b376665008b45d0) Thanks [@ayden94](https://github.com/ayden94)! - Align the public microservice facade shutdown contract with runtime lifecycle signal forwarding while preserving no-argument transport shutdown adapters.

- [#2390](https://github.com/fluojs/fluo/pull/2390) [`efe09b4`](https://github.com/fluojs/fluo/commit/efe09b441a9515c431957d759df3a871529494ea) Thanks [@ayden94](https://github.com/ayden94)! - Close internally-created MQTT clients when subscription setup fails during startup or when shutdown unwinds a failed in-flight listen attempt.

- [#2301](https://github.com/fluojs/fluo/pull/2301) [`5b0d418`](https://github.com/fluojs/fluo/commit/5b0d41820b20b59a6311e069daa35d741850424c) Thanks [@ayden94](https://github.com/ayden94)! - Close NATS, RabbitMQ, and Redis Streams microservice transports consistently when listen and close race, preserving shutdown guards and Redis Streams cleanup before surfacing startup failures.

- [#2714](https://github.com/fluojs/fluo/pull/2714) [`62b073c`](https://github.com/fluojs/fluo/commit/62b073c39eb65849d18970a284be99782b2c67c0) Thanks [@ayden94](https://github.com/ayden94)! - Restore gRPC `AbortSignal` listener cleanup when server and bidirectional streams end or error before reader iteration, and keep client, server, and bidirectional cleanup one-shot across terminal and early-return races.

  Migration: no API or configuration changes are required. Existing consumers can keep their current stream usage and rely on abort listeners being detached on every terminal or reader-return path.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/core@1.1.0

## 1.0.4

### Patch Changes

- [#2122](https://github.com/fluojs/fluo/pull/2122) [`6285f26`](https://github.com/fluojs/fluo/commit/6285f26f84bfcddb11018ff25e137bbb7c0b0005) Thanks [@ayden94](https://github.com/ayden94)! - Align microservice transport status metadata with actual resource ownership and export `TcpMicroserviceTransportOptions` from the root barrel so the public constructor surface is documented and type-accessible.

- [#2236](https://github.com/fluojs/fluo/pull/2236) [`120a2ee`](https://github.com/fluojs/fluo/commit/120a2eed817c80101ba7393f92a952d3f11d1619) Thanks [@ayden94](https://github.com/ayden94)! - Tighten microservice transport lifecycle and abort contracts so Kafka, MQTT, Redis Streams, and gRPC re-check cancellation before deferred dispatch, close/listen races cannot reopen an in-progress shutdown, and caller-supplied gRPC servers remain caller-owned during close.

- Updated dependencies [[`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/runtime@1.1.8

## Unreleased

## 1.0.3

### Patch Changes

- [#2084](https://github.com/fluojs/fluo/pull/2084) [`b5a3289`](https://github.com/fluojs/fluo/commit/b5a32890a3c3384d3e8511e81032b80bd8a054d1) Thanks [@ayden94](https://github.com/ayden94)! - Defer TCP `node:net` loading until listen or outbound socket construction paths and preserve transport cleanup when closing after failed in-flight listen attempts.

- Updated dependencies [[`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65)]:
  - @fluojs/runtime@1.1.7

## 1.0.2

### Patch Changes

- [#1844](https://github.com/fluojs/fluo/pull/1844) [`70a93bf`](https://github.com/fluojs/fluo/commit/70a93bf1250c85b08b292e669828fd965a590a6e) Thanks [@ayden94](https://github.com/ayden94)! - Reject Redis Pub/Sub and Redis Streams event emits once transport shutdown has started so no outbound work is accepted during a closing lifecycle.

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.1

## 1.0.0

### Minor Changes

- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- fa0ecca: Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
- 1dda8b5: Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.
- 8e7acc7: Fix TCP shutdown guards and gRPC streaming AbortSignal cleanup so closing microservice transports reject new work and release stream abort listeners reliably.
- cf14bbb: Correct the microservices README example references and clarify that RabbitMQ request/reply uses instance-scoped response queues rather than direct reply-to.
- 106e51d: Tighten microservice transport ownership, abort, and shutdown contracts so caller-owned NATS clients are not closed by transport shutdown, NATS request/reply honors AbortSignal, and NATS/Kafka/RabbitMQ reject new publishes once close starts.
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

## 1.0.0-beta.6

### Patch Changes

- [#1638](https://github.com/fluojs/fluo/pull/1638) [`8e7acc7`](https://github.com/fluojs/fluo/commit/8e7acc789c2fb15c3a23401ffc478629b7f7b478) Thanks [@ayden94](https://github.com/ayden94)! - Fix TCP shutdown guards and gRPC streaming AbortSignal cleanup so closing microservice transports reject new work and release stream abort listeners reliably.

- [#1699](https://github.com/fluojs/fluo/pull/1699) [`cf14bbb`](https://github.com/fluojs/fluo/commit/cf14bbb44237203ad9a361a001d883046de90e5e) Thanks [@ayden94](https://github.com/ayden94)! - Correct the microservices README example references and clarify that RabbitMQ request/reply uses instance-scoped response queues rather than direct reply-to.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.5

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

## 1.0.0-beta.4

### Patch Changes

- [#1544](https://github.com/fluojs/fluo/pull/1544) [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5) Thanks [@ayden94](https://github.com/ayden94)! - Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.

- Updated dependencies [[`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3), [`93fc34b`](https://github.com/fluojs/fluo/commit/93fc34bba9d82870da49d9e69ad6e62821f598b0)]:
  - @fluojs/core@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.11

## 1.0.0-beta.3

### Patch Changes

- [#1380](https://github.com/fluojs/fluo/pull/1380) [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440) Thanks [@ayden94](https://github.com/ayden94)! - Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.

- Updated dependencies [[`da003a1`](https://github.com/fluojs/fluo/commit/da003a1a5f7fec7b46fcf37d5a19a91e04d8b301), [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440), [`33d51e1`](https://github.com/fluojs/fluo/commit/33d51e163b2fc6d2cf43b820a91d0b95ee552e75), [`c509e27`](https://github.com/fluojs/fluo/commit/c509e27da630c0cd5cffbfc72381dbc1594efc1c)]:
  - @fluojs/runtime@1.0.0-beta.3
  - @fluojs/core@1.0.0-beta.2
  - @fluojs/di@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- [#1358](https://github.com/fluojs/fluo/pull/1358) [`106e51d`](https://github.com/fluojs/fluo/commit/106e51d92023c22d7ad1bdb2df2723f8f6986422) Thanks [@ayden94](https://github.com/ayden94)! - Tighten microservice transport ownership, abort, and shutdown contracts so caller-owned NATS clients are not closed by transport shutdown, NATS request/reply honors AbortSignal, and NATS/Kafka/RabbitMQ reject new publishes once close starts.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
