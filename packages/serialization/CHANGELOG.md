# @fluojs/serialization

## [Unreleased]

## 2.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

### Patch Changes

- [#3493](https://github.com/fluojs/fluo/pull/3493) [`c0b7195`](https://github.com/fluojs/fluo/commit/c0b719516aa3b4a8fe334bcc7106046d1d3018db) Thanks [@ayden94](https://github.com/ayden94)! - Isolate inherited serialization decorator metadata so derived DTO overrides cannot change base or sibling output.

- Updated dependencies [[`06c5c62`](https://github.com/fluojs/fluo/commit/06c5c620ae821fb4181ea019cb16d3756d1fa81a), [`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`c6b0af7`](https://github.com/fluojs/fluo/commit/c6b0af7926e1f94b36ead0ed2678dbd984790ac6), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`eb0ee7f`](https://github.com/fluojs/fluo/commit/eb0ee7fc97bb174607fa87f2deeb93ebd46d6340), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`8e191c2`](https://github.com/fluojs/fluo/commit/8e191c2c9664bf58b402875b7a40b02b5ade012e), [`81e4fb5`](https://github.com/fluojs/fluo/commit/81e4fb5743d83e286fc3d3dac6999ce281c2a9a3), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`9380550`](https://github.com/fluojs/fluo/commit/9380550c6986dd8af05896899c2b1c5814c7db79), [`0d130d5`](https://github.com/fluojs/fluo/commit/0d130d5210ee3b4a02811aedd4f86bcc06818a7d), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`1ecaea2`](https://github.com/fluojs/fluo/commit/1ecaea2bfe3f9fa5c229fe5707e2b6c94378136b), [`b6343ea`](https://github.com/fluojs/fluo/commit/b6343ea89db7d7131aded2d3b829425046e70a1b), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8354f8c`](https://github.com/fluojs/fluo/commit/8354f8cb3b038ff85948296e18bb97880a291389), [`2aef2a7`](https://github.com/fluojs/fluo/commit/2aef2a7cabe819e32b6bcc07ebc3ecbad34cc049), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`44125db`](https://github.com/fluojs/fluo/commit/44125db098f68fc751bc5300c5abe7036a403736), [`50a22dd`](https://github.com/fluojs/fluo/commit/50a22dd22774eedfa4847e81d22f6cb592d2a30e), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`ac6e32c`](https://github.com/fluojs/fluo/commit/ac6e32c0e108e236800c497342d8e5e66b9175a9), [`605a0fc`](https://github.com/fluojs/fluo/commit/605a0fcd1194332d51694f7e59323c897fe5c566), [`2dc5ee8`](https://github.com/fluojs/fluo/commit/2dc5ee8771e4b6dfb24a740e44bae0000bee1409), [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2), [`1817f04`](https://github.com/fluojs/fluo/commit/1817f04a2629f05147faea76cd3615cf1cca28ac), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`19a1abe`](https://github.com/fluojs/fluo/commit/19a1abe728bda9dae7c2eb90b4174ca4e2b15cf8), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367)]:
  - @fluojs/http@3.0.0
  - @fluojs/core@2.0.0

## 1.0.5

### Patch Changes

- [#2299](https://github.com/fluojs/fluo/pull/2299) [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896) Thanks [@ayden94](https://github.com/ayden94)! - Add the documented `@fluojs/core/request-pipeline` metadata integration seam and migrate validation, serialization, and OpenAPI internals to it instead of importing `@fluojs/core/internal` directly.

- Updated dependencies [[`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/http@2.0.0
  - @fluojs/core@1.1.0

## 1.0.4

### Patch Changes

- [#2023](https://github.com/fluojs/fluo/pull/2023) [`fc95494`](https://github.com/fluojs/fluo/commit/fc95494fdd3972c7bade7043c8031bbc55742f12) Thanks [@ayden94](https://github.com/ayden94)! - Avoid installing `Symbol.metadata` during validation and serialization imports, export the public `TransformFunction` type from serialization, and add regression coverage for documented validation and HTTP serialization contracts.

## 1.0.3

### Patch Changes

- [#1994](https://github.com/fluojs/fluo/pull/1994) [`45b50e6`](https://github.com/fluojs/fluo/commit/45b50e649b5f3a833555523c20b11d3bb0a07f5b) Thanks [@ayden94](https://github.com/ayden94)! - Align validation and serialization edge contracts with regression coverage for IP options, dangerous keys, custom scalar validators, cyclic arrays, and mixed object graphs.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/core@1.0.3
  - @fluojs/http@1.1.0

## 1.0.2

### Patch Changes

- [#1862](https://github.com/fluojs/fluo/pull/1862) [`1b63a98`](https://github.com/fluojs/fluo/commit/1b63a98faf04c2b7e58f867e3daf71a3f262b7dd) Thanks [@ayden94](https://github.com/ayden94)! - Prevent decorated class serialization from copying non-enumerable symbol properties while keeping enumerable symbol keys and documented transform examples aligned with the public `unknown` transform callback contract.

- Updated dependencies [[`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/core@1.0.1

## 1.0.0

### Patch Changes

- fa0ecca: Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
- 1dda8b5: Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.
- 3c44712: Preserve inherited excludeExtraneous serialization metadata when derived DTOs use class-level Expose without options.
- 00f4d90: Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

- 15c571e: Preserve opaque built-in response values such as Map, Set, URL, and Error during serialization instead of flattening them as empty DTO-like objects.
- Updated dependencies [01d5e65]
- Updated dependencies [4fdb48c]
- Updated dependencies [72462e3]
- Updated dependencies [c5aebdf]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [1dda8b5]
- Updated dependencies [3f70169]
- Updated dependencies [aaab8c4]
- Updated dependencies [a625716]
- Updated dependencies [45e0f1b]
- Updated dependencies [b82b28f]
- Updated dependencies [37ae1c5]
- Updated dependencies [16420f9]
- Updated dependencies [53a2b8e]
- Updated dependencies [e1bce3d]
- Updated dependencies [3baf5df]
- Updated dependencies [7b50db8]
- Updated dependencies [69936b1]
- Updated dependencies [35f60fd]
- Updated dependencies [28ca2ef]
  - @fluojs/http@1.0.0
  - @fluojs/core@1.0.0

## 1.0.0-beta.6

### Patch Changes

- [#1650](https://github.com/fluojs/fluo/pull/1650) [`3c44712`](https://github.com/fluojs/fluo/commit/3c447127d65ea74f0574cae6b49ae4f6a579cce3) Thanks [@ayden94](https://github.com/ayden94)! - Preserve inherited excludeExtraneous serialization metadata when derived DTOs use class-level Expose without options.

- Updated dependencies [[`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0)]:
  - @fluojs/core@1.0.0-beta.5

## 1.0.0-beta.5

### Patch Changes

- [#1544](https://github.com/fluojs/fluo/pull/1544) [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5) Thanks [@ayden94](https://github.com/ayden94)! - Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.

- Updated dependencies [[`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3), [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5)]:
  - @fluojs/core@1.0.0-beta.4
  - @fluojs/http@1.0.0-beta.10

## 1.0.0-beta.4

### Patch Changes

- [#1517](https://github.com/fluojs/fluo/pull/1517) [`15c571e`](https://github.com/fluojs/fluo/commit/15c571e53e2a45bec1ceab6f8a9551238972ca5f) Thanks [@ayden94](https://github.com/ayden94)! - Preserve opaque built-in response values such as Map, Set, URL, and Error during serialization instead of flattening them as empty DTO-like objects.

- Updated dependencies [[`c5aebdf`](https://github.com/fluojs/fluo/commit/c5aebdfe141bda72a6701516c48ace0f5caf5ee2)]:
  - @fluojs/core@1.0.0-beta.3

## 1.0.0-beta.3

### Patch Changes

- [#1380](https://github.com/fluojs/fluo/pull/1380) [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440) Thanks [@ayden94](https://github.com/ayden94)! - Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.

- Updated dependencies [[`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440)]:
  - @fluojs/core@1.0.0-beta.2
  - @fluojs/http@1.0.0-beta.2

## 1.0.0-beta.2

### Patch Changes

- [#1349](https://github.com/fluojs/fluo/pull/1349) [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a) Thanks [@ayden94](https://github.com/ayden94)! - Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.
