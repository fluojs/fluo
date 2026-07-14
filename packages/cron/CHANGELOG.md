# @fluojs/cron

## [Unreleased]

## 2.0.1

### Patch Changes

- [#2758](https://github.com/fluojs/fluo/pull/2758) [`dedaf71`](https://github.com/fluojs/fluo/commit/dedaf71024b3bd7e77403a183e0e0916222554b1) Thanks [@ayden94](https://github.com/ayden94)! - Validate explicit Cron distributed `ownerId` before scheduler or Redis lifecycle setup.

  `CronModule.forRoot({ distributed: { ownerId } })` now trims the provided `ownerId` during module option normalization and rejects blank, empty, or non-string values before the scheduler or Redis distributed lock lifecycle begins. Previously, invalid or empty owner identifiers could enter Redis lock ownership state despite the distributed-lock contract. Applications that already pass a non-empty string `ownerId` are unaffected; applications relying on blank or whitespace-only `ownerId` values must now provide a valid stable owner identifier or omit `ownerId` to keep the platform-neutral default.

- Updated dependencies [[`65cc3a2`](https://github.com/fluojs/fluo/commit/65cc3a28457d58b75858ed33ab7280b09900db36)]:
  - @fluojs/runtime@2.0.1

## 2.0.0

### Major Changes

- [#2399](https://github.com/fluojs/fluo/pull/2399) [`c646d44`](https://github.com/fluojs/fluo/commit/c646d44cbfe7f34aa77505ba8c6948fc1c9e1481) Thanks [@ayden94](https://github.com/ayden94)! - Reject blank decorator scheduling task names, normalize distributed Redis client names, and cover cron lifecycle/status regression paths.

  Migration notes:

  - Replace blank decorator `name` values with stable non-empty names, and move any scheduled static methods behind public instance methods.
  - Remove leading or trailing whitespace from `distributed.clientName` and register the Redis client under that trimmed name, or omit `clientName` to keep using the default Redis registration.

- [#2481](https://github.com/fluojs/fluo/pull/2481) [`32f3a60`](https://github.com/fluojs/fluo/commit/32f3a609a2bb061fb4aebfddbb6545ca8a342212) Thanks [@ayden94](https://github.com/ayden94)! - Preserve distributed lock lifecycle contracts by validating enabled lock TTLs before Redis I/O, bounding shutdown lock release attempts, retaining local ownership when release I/O times out, and returning immutable scheduling descriptor snapshots.

  Migration notes:

  - Configure every enabled module-level `distributed.lockTtlMs` and enabled task-level `lockTtlMs` as an integer of at least `1_000ms` before module registration.
  - Treat values from `SchedulingRegistry.get()` and `getAll()` as immutable snapshots. Use `enable()`, `disable()`, `remove()`, `updateCronExpression()`, or `updateIntervalMs()` instead of mutating descriptors or scheduler handles.
  - Review `shutdown.timeoutMs` against expected Redis latency. Owned-lock release I/O now stops waiting at that boundary and preserves local ownership visibility when the release cannot be confirmed in time.

### Patch Changes

- [#2304](https://github.com/fluojs/fluo/pull/2304) [`d4d2af3`](https://github.com/fluojs/fluo/commit/d4d2af3b3c99c63dbc8561ffdd5ba52d10914148) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Redis distributed cron locks during startup rollback until active bootstrap-time ticks can drain and release ownership.

- [#2622](https://github.com/fluojs/fluo/pull/2622) [`aa0fd73`](https://github.com/fluojs/fluo/commit/aa0fd737e36e116a566fbd8a1122e211cb62dbbd) Thanks [@ayden94](https://github.com/ayden94)! - Make dynamic cron expression and interval cadence replacements roll back when the previous scheduler handle cannot be stopped, cleaning up the provisional replacement before restoring the prior descriptor and handle.

- [#2612](https://github.com/fluojs/fluo/pull/2612) [`26855dc`](https://github.com/fluojs/fluo/commit/26855dc3e19730bc4b5a9e4563d4e656e4efc00e) Thanks [@ayden94](https://github.com/ayden94)! - Ignore inactive task lock TTL overrides when distributed locking is disabled and call `unref()` on lock renewal timers so bounded shutdown can allow the Node.js process to exit.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/core@1.1.0

## 1.1.0

### Minor Changes

- [#2243](https://github.com/fluojs/fluo/pull/2243) [`a8594c6`](https://github.com/fluojs/fluo/commit/a8594c694d1674be80f407978a64155b2ab990cb) Thanks [@ayden94](https://github.com/ayden94)! - Add `SchedulingRegistry.updateIntervalMs(name, ms)` for rollback-safe runtime interval cadence updates.

### Patch Changes

- [#2124](https://github.com/fluojs/fluo/pull/2124) [`ae7a414`](https://github.com/fluojs/fluo/commit/ae7a4149b2b903e9f73a7428194804060635f191) Thanks [@ayden94](https://github.com/ayden94)! - Honor `options.name` as the registry key, scheduler metadata name, and default distributed lock key for dynamically registered cron, interval, and timeout tasks.

- [#2240](https://github.com/fluojs/fluo/pull/2240) [`1ee8874`](https://github.com/fluojs/fluo/commit/1ee8874317678e0a5dc41443456463a959e8be89) Thanks [@ayden94](https://github.com/ayden94)! - Harden distributed lock readiness and shutdown retry semantics so Redis lock I/O outages no longer report ready/healthy and timed-out task lock releases can be retried after the task settles.

- Updated dependencies [[`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/runtime@1.1.8

## 1.0.3

### Patch Changes

- [#2076](https://github.com/fluojs/fluo/pull/2076) [`035b94d`](https://github.com/fluojs/fluo/commit/035b94d2091cdb1e6cafda7cf0e4ae3288357111) Thanks [@ayden94](https://github.com/ayden94)! - Make Redis a distributed-lock-only dependency for `@fluojs/cron`. Non-distributed scheduling no longer loads the Redis peer during import, registration, bootstrap, or status snapshot creation.

- Updated dependencies [[`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65)]:
  - @fluojs/runtime@1.1.7

## 1.0.2

### Patch Changes

- [#1852](https://github.com/fluojs/fluo/pull/1852) [`a8aa3b1`](https://github.com/fluojs/fluo/commit/a8aa3b1ca99e26be9c094e00987ff0828f8fc1dd) Thanks [@ayden94](https://github.com/ayden94)! - Make dynamic cron registration and cron expression updates rollback-safe when scheduler startup fails, and document scheduler dependency ownership plus public registry/type contracts.

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.1

## 1.0.0

### Minor Changes

- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- fa0ecca: Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
- 240be94: Use platform-neutral default distributed lock owner IDs, retain local lock ownership after Redis release failures so shutdown can retry, and document cron expression portability plus distributed-lock drift/fencing caveats.
- 1dda8b5: Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.
- d05ee13: Preserve active distributed cron locks when bounded shutdown times out so another node cannot start the same job while the original task is still running.
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
- Updated dependencies [00f4d90]
- Updated dependencies [f1a94b2]
- Updated dependencies [ea86ded]
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
  - @fluojs/redis@1.0.0

## 1.0.0-beta.6

### Patch Changes

- [#1632](https://github.com/fluojs/fluo/pull/1632) [`240be94`](https://github.com/fluojs/fluo/commit/240be9456a80759dc543eeeee93b4b453287630e) Thanks [@ayden94](https://github.com/ayden94)! - Use platform-neutral default distributed lock owner IDs, retain local lock ownership after Redis release failures so shutdown can retry, and document cron expression portability plus distributed-lock drift/fencing caveats.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`f1a94b2`](https://github.com/fluojs/fluo/commit/f1a94b2e184c8f4507294a826676d36b218a5bbb), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/redis@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.5

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- Updated dependencies [[`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299)]:
  - @fluojs/redis@1.0.0-beta.3

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

- [#1352](https://github.com/fluojs/fluo/pull/1352) [`d05ee13`](https://github.com/fluojs/fluo/commit/d05ee1326a9e76ed97104d74c2751950aeecd8fb) Thanks [@ayden94](https://github.com/ayden94)! - Preserve active distributed cron locks when bounded shutdown times out so another node cannot start the same job while the original task is still running.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/redis@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
