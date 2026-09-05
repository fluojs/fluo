# @fluojs/i18n

## [Unreleased]

## 3.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

### Patch Changes

- [#2837](https://github.com/fluojs/fluo/pull/2837) [`58de97b`](https://github.com/fluojs/fluo/commit/58de97bc9773b96b9d63e44012eeb58f0cd38cad) Thanks [@ayden94](https://github.com/ayden94)! - Remove each remote catalog load's internal abort listener after the load succeeds or fails while preserving timeout and caller cancellation behavior.

- [#3484](https://github.com/fluojs/fluo/pull/3484) [`f0226de`](https://github.com/fluojs/fluo/commit/f0226de3369541fa951c9c8a61baa67ee3ce8931) Thanks [@ayden94](https://github.com/ayden94)! - Reject colliding catalog typegen declaration identifiers with `I18N_INVALID_OPTIONS` before emitting invalid TypeScript.

- [#3489](https://github.com/fluojs/fluo/pull/3489) [`1bb4f23`](https://github.com/fluojs/fluo/commit/1bb4f232617422cb3cb34b9c207d555d2db2b1e0) Thanks [@ayden94](https://github.com/ayden94)! - Preserve prototype-colliding message keys and report cyclic catalogs with `I18N_INVALID_CATALOG`.

- [#3490](https://github.com/fluojs/fluo/pull/3490) [`0f10279`](https://github.com/fluojs/fluo/commit/0f10279d11807bcc17f0dcc1f53b9be4462a2722) Thanks [@ayden94](https://github.com/ayden94)! - Centralize internal catalog provenance and locale resolver-chain resolution without changing public i18n behavior.

- [#3486](https://github.com/fluojs/fluo/pull/3486) [`ecff0c5`](https://github.com/fluojs/fluo/commit/ecff0c52dce8639f0074c3730dfcb1c2971ecfb0) Thanks [@ayden94](https://github.com/ayden94)! - Document NestJS catalog aggregation and fallback migration guidance.

- [#3483](https://github.com/fluojs/fluo/pull/3483) [`ac9fbb7`](https://github.com/fluojs/fluo/commit/ac9fbb75041128c47ae587744ae6b9eb866d7013) Thanks [@ayden94](https://github.com/ayden94)! - Correct the 2.0 migration rationale: the optional `@fluojs/i18n/http` subpath uses `@fluojs/http`'s `RequestContext` boundary, while the root entry point remains framework-agnostic. Upgrading `@fluojs/i18n` does not require `ResponseFormatter` migration work.

- [#3487](https://github.com/fluojs/fluo/pull/3487) [`fb011ce`](https://github.com/fluojs/fluo/commit/fb011cecf8e34b599f017af00414c017f5c15263) Thanks [@ayden94](https://github.com/ayden94)! - Restore remote loader timeout validation, successful-load TTL caching, and provider error propagation contracts.

- Updated dependencies [[`06c5c62`](https://github.com/fluojs/fluo/commit/06c5c620ae821fb4181ea019cb16d3756d1fa81a), [`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`c6b0af7`](https://github.com/fluojs/fluo/commit/c6b0af7926e1f94b36ead0ed2678dbd984790ac6), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`8b63f78`](https://github.com/fluojs/fluo/commit/8b63f78b87f4cd28c040d4a5bf50bb26501b5b7d), [`eb0ee7f`](https://github.com/fluojs/fluo/commit/eb0ee7fc97bb174607fa87f2deeb93ebd46d6340), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`8e191c2`](https://github.com/fluojs/fluo/commit/8e191c2c9664bf58b402875b7a40b02b5ade012e), [`81e4fb5`](https://github.com/fluojs/fluo/commit/81e4fb5743d83e286fc3d3dac6999ce281c2a9a3), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`9380550`](https://github.com/fluojs/fluo/commit/9380550c6986dd8af05896899c2b1c5814c7db79), [`0d130d5`](https://github.com/fluojs/fluo/commit/0d130d5210ee3b4a02811aedd4f86bcc06818a7d), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`4f89ac4`](https://github.com/fluojs/fluo/commit/4f89ac4dc77169badb160804d86f78d612989af4), [`1ecaea2`](https://github.com/fluojs/fluo/commit/1ecaea2bfe3f9fa5c229fe5707e2b6c94378136b), [`b6343ea`](https://github.com/fluojs/fluo/commit/b6343ea89db7d7131aded2d3b829425046e70a1b), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`758fa42`](https://github.com/fluojs/fluo/commit/758fa42f64317751123d5a9ff8e03c414fc20fb2), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8354f8c`](https://github.com/fluojs/fluo/commit/8354f8cb3b038ff85948296e18bb97880a291389), [`2aef2a7`](https://github.com/fluojs/fluo/commit/2aef2a7cabe819e32b6bcc07ebc3ecbad34cc049), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`44125db`](https://github.com/fluojs/fluo/commit/44125db098f68fc751bc5300c5abe7036a403736), [`2cce586`](https://github.com/fluojs/fluo/commit/2cce58646b5b10e6fb39c4b54c1d74734e7308c5), [`50a22dd`](https://github.com/fluojs/fluo/commit/50a22dd22774eedfa4847e81d22f6cb592d2a30e), [`5e59219`](https://github.com/fluojs/fluo/commit/5e59219c5346d9fa3d70719f7204fcf5e9f602f6), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`5dec76e`](https://github.com/fluojs/fluo/commit/5dec76e05a229b4ef52d112fd593bc167e650a3c), [`08ea346`](https://github.com/fluojs/fluo/commit/08ea346cdfb087da050f961cdb4d5841dc922e51), [`ac6e32c`](https://github.com/fluojs/fluo/commit/ac6e32c0e108e236800c497342d8e5e66b9175a9), [`605a0fc`](https://github.com/fluojs/fluo/commit/605a0fcd1194332d51694f7e59323c897fe5c566), [`2dc5ee8`](https://github.com/fluojs/fluo/commit/2dc5ee8771e4b6dfb24a740e44bae0000bee1409), [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2), [`1817f04`](https://github.com/fluojs/fluo/commit/1817f04a2629f05147faea76cd3615cf1cca28ac), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`19a1abe`](https://github.com/fluojs/fluo/commit/19a1abe728bda9dae7c2eb90b4174ca4e2b15cf8), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367)]:
  - @fluojs/http@3.0.0
  - @fluojs/core@2.0.0
  - @fluojs/validation@2.0.0

## 2.0.0

### Major Changes

- [#2439](https://github.com/fluojs/fluo/pull/2439) [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff) Thanks [@ayden94](https://github.com/ayden94)! - Bump major in lockstep with `@fluojs/http@2.0.0` because `@fluojs/i18n` depends on the HTTP package's public `ResponseFormatter` contract. The i18n package itself has no breaking API changes; consumers upgrading from `@fluojs/i18n@1.x` should follow the migration notes for `@fluojs/http` (`ResponseFormatter.format(...)` now returns runtime-neutral `Uint8Array` instead of Node-specific `Buffer`).

### Patch Changes

- [#2648](https://github.com/fluojs/fluo/pull/2648) [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925) Thanks [@ayden94](https://github.com/ayden94)! - Restore the governed `Unreleased` changelog placeholder for foundation packages and preserve it when Changesets generates future package versions.

- [#2428](https://github.com/fluojs/fluo/pull/2428) [`6934b0a`](https://github.com/fluojs/fluo/commit/6934b0a2f797d0376249a25e8dec3e14784db4ca) Thanks [@ayden94](https://github.com/ayden94)! - Align the i18n root package runtime metadata with its framework-agnostic import contract and document the global-by-default module provider visibility.

- Updated dependencies [[`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/http@2.0.0
  - @fluojs/core@1.1.0

## 1.0.3

### Patch Changes

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`45b50e6`](https://github.com/fluojs/fluo/commit/45b50e649b5f3a833555523c20b11d3bb0a07f5b), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/core@1.0.3
  - @fluojs/validation@1.0.4
  - @fluojs/http@1.1.0

## 1.0.2

### Patch Changes

- [#1868](https://github.com/fluojs/fluo/pull/1868) [`44e2c56`](https://github.com/fluojs/fluo/commit/44e2c562714742020639754151dc02cf9ffe1fb8) Thanks [@ayden94](https://github.com/ayden94)! - Match `Accept-Language` locale ranges case-insensitively while preserving the configured supported locale spelling in HTTP and non-HTTP locale resolvers.

- Updated dependencies [[`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/core@1.0.1
  - @fluojs/validation@1.0.1

## 1.0.0

### Minor Changes

- 55cd0af: Add a Node-only `@fluojs/i18n/loaders/fs` subpath for safely loading JSON catalogs from filesystem locale directories.
- a24fa3f: Add the `@fluojs/i18n/typegen` subpath for opt-in TypeScript translation key declaration generation from locale catalog trees and JSON catalog directories.
- 7fcadbe: Add the `@fluojs/i18n/http` subpath with explicit fluo HTTP request-context locale helpers, `Accept-Language` parsing, and ordered resolver-chain utilities.
- 849497f: Add the `@fluojs/i18n/icu` subpath with ICU MessageFormat plural/select formatting on top of the existing core catalog fallback and interpolation behavior.
- 4d059ee: Add opt-in locale policy resolvers and remote catalog cache wrappers while preserving default `Accept-Language: *` and uncached remote loader behavior.
- 24f6531: Add the `@fluojs/i18n/adapters` subpath with opt-in non-HTTP locale resolvers and stores for WebSocket, gRPC, CLI, local storage, and request-style abstractions.
- 22bfd25: Introduce the fluo-native i18n package with a framework-agnostic core translation service, locale-scoped catalogs, deterministic fallback resolution, interpolation, missing-message hooks, and stable configuration/catalog error codes.
- 947a842: Add opt-in generated i18n type helper declarations so applications can type fully qualified translation keys and namespace-scoped key facades without narrowing the runtime `I18nService.translate(key: string, ...)` method.
- b9c7e5d: Add the `@fluojs/i18n/validation` subpath for opt-in localization of `@fluojs/validation` issue messages while preserving default validation behavior.
- 44587f8: Add standard `Intl` date/time, number, currency, percent, list, and relative-time formatting helpers with explicit locales and immutable named formatter option snapshots.
- b578488: Add the `@fluojs/i18n/loaders/remote` subpath for provider-backed remote catalog loading with timeout, cancellation, provider failure, missing catalog, invalid JSON, invalid tree shape, and immutable snapshot guarantees.
- 5aef583: Keep optional i18n subpath integrations out of the default root dependency graph while documenting their peer prerequisites and hardening fallback, interpolation, and remote-loader cancellation contract coverage.

  Upgrade note: consumers that import `@fluojs/i18n/icu`, `@fluojs/i18n/http`, or `@fluojs/i18n/validation` must list the matching peer dependency in their application or package manifest: `intl-messageformat` for ICU formatting, `@fluojs/http` for HTTP locale helpers, and `@fluojs/validation` for validation localization. The root `@fluojs/i18n` entry point does not require these integration peers.

### Patch Changes

- Updated dependencies [01d5e65]
- Updated dependencies [4fdb48c]
- Updated dependencies [72462e3]
- Updated dependencies [c5aebdf]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [b15ac1b]
- Updated dependencies [1dda8b5]
- Updated dependencies [3f70169]
- Updated dependencies [aaab8c4]
- Updated dependencies [65a08db]
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
- Updated dependencies [8422e56]
  - @fluojs/http@1.0.0
  - @fluojs/core@1.0.0
  - @fluojs/validation@1.0.0

## 1.0.0-beta.1

### Minor Changes

- [#1722](https://github.com/fluojs/fluo/pull/1722) [`55cd0af`](https://github.com/fluojs/fluo/commit/55cd0afd12eb1d6df716b82b8dff48341bd5f8ec) Thanks [@ayden94](https://github.com/ayden94)! - Add a Node-only `@fluojs/i18n/loaders/fs` subpath for safely loading JSON catalogs from filesystem locale directories.

- [#1737](https://github.com/fluojs/fluo/pull/1737) [`a24fa3f`](https://github.com/fluojs/fluo/commit/a24fa3ffeefbe9d5aa32e5d8a47d53ab454a9483) Thanks [@ayden94](https://github.com/ayden94)! - Add the `@fluojs/i18n/typegen` subpath for opt-in TypeScript translation key declaration generation from locale catalog trees and JSON catalog directories.

- [#1721](https://github.com/fluojs/fluo/pull/1721) [`7fcadbe`](https://github.com/fluojs/fluo/commit/7fcadbe7eb65d017944fde1f9c937af9e1d7fe52) Thanks [@ayden94](https://github.com/ayden94)! - Add the `@fluojs/i18n/http` subpath with explicit fluo HTTP request-context locale helpers, `Accept-Language` parsing, and ordered resolver-chain utilities.

- [#1735](https://github.com/fluojs/fluo/pull/1735) [`849497f`](https://github.com/fluojs/fluo/commit/849497fb319ded12604ff75e9a9766010bb2f96e) Thanks [@ayden94](https://github.com/ayden94)! - Add the `@fluojs/i18n/icu` subpath with ICU MessageFormat plural/select formatting on top of the existing core catalog fallback and interpolation behavior.

- [#1745](https://github.com/fluojs/fluo/pull/1745) [`4d059ee`](https://github.com/fluojs/fluo/commit/4d059eee96c5956bfa16ec2bf56aa4ec1da03012) Thanks [@ayden94](https://github.com/ayden94)! - Add opt-in locale policy resolvers and remote catalog cache wrappers while preserving default `Accept-Language: *` and uncached remote loader behavior.

- [#1739](https://github.com/fluojs/fluo/pull/1739) [`24f6531`](https://github.com/fluojs/fluo/commit/24f6531ad083778e34e5ee1611a768885902c5c0) Thanks [@ayden94](https://github.com/ayden94)! - Add the `@fluojs/i18n/adapters` subpath with opt-in non-HTTP locale resolvers and stores for WebSocket, gRPC, CLI, local storage, and request-style abstractions.

- [#1718](https://github.com/fluojs/fluo/pull/1718) [`22bfd25`](https://github.com/fluojs/fluo/commit/22bfd251a9721103415b2312d20e4a23b8268cb0) Thanks [@ayden94](https://github.com/ayden94)! - Introduce the fluo-native i18n package with a framework-agnostic core translation service, locale-scoped catalogs, deterministic fallback resolution, interpolation, missing-message hooks, and stable configuration/catalog error codes.

- [#1746](https://github.com/fluojs/fluo/pull/1746) [`947a842`](https://github.com/fluojs/fluo/commit/947a8423c6c3e0e754a325f2937997234fe757f5) Thanks [@ayden94](https://github.com/ayden94)! - Add opt-in generated i18n type helper declarations so applications can type fully qualified translation keys and namespace-scoped key facades without narrowing the runtime `I18nService.translate(key: string, ...)` method.

- [#1738](https://github.com/fluojs/fluo/pull/1738) [`b9c7e5d`](https://github.com/fluojs/fluo/commit/b9c7e5d9ad0e83a799c0203fb8494cbce7a08985) Thanks [@ayden94](https://github.com/ayden94)! - Add the `@fluojs/i18n/validation` subpath for opt-in localization of `@fluojs/validation` issue messages while preserving default validation behavior.

- [#1723](https://github.com/fluojs/fluo/pull/1723) [`44587f8`](https://github.com/fluojs/fluo/commit/44587f8c3352a0bb954fbc3775800ce0aa22e5f3) Thanks [@ayden94](https://github.com/ayden94)! - Add standard `Intl` date/time, number, currency, percent, list, and relative-time formatting helpers with explicit locales and immutable named formatter option snapshots.

- [#1736](https://github.com/fluojs/fluo/pull/1736) [`b578488`](https://github.com/fluojs/fluo/commit/b578488d25e198d0859549eb41193cc6f9defa52) Thanks [@ayden94](https://github.com/ayden94)! - Add the `@fluojs/i18n/loaders/remote` subpath for provider-backed remote catalog loading with timeout, cancellation, provider failure, missing catalog, invalid JSON, invalid tree shape, and immutable snapshot guarantees.

- [#1767](https://github.com/fluojs/fluo/pull/1767) [`5aef583`](https://github.com/fluojs/fluo/commit/5aef583ea13a1372ca5de9e04860d7050676d2f6) Thanks [@ayden94](https://github.com/ayden94)! - Keep optional i18n subpath integrations out of the default root dependency graph while documenting their peer prerequisites and hardening fallback, interpolation, and remote-loader cancellation contract coverage.

  Upgrade note: consumers that import `@fluojs/i18n/icu`, `@fluojs/i18n/http`, or `@fluojs/i18n/validation` must list the matching peer dependency in their application or package manifest: `intl-messageformat` for ICU formatting, `@fluojs/http` for HTTP locale helpers, and `@fluojs/validation` for validation localization. The root `@fluojs/i18n` entry point does not require these integration peers.

### Patch Changes

- Updated dependencies [[`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157), [`45e0f1b`](https://github.com/fluojs/fluo/commit/45e0f1bf877ba69544d93094d9c54657ea941e74), [`7b50db8`](https://github.com/fluojs/fluo/commit/7b50db85e95e2341f82d006f1e665c2bbcebeaa5)]:
  - @fluojs/core@1.0.0-beta.6
  - @fluojs/http@1.0.0-beta.11

## 1.0.0-beta.0

### Initial scaffold

- Add the initial public package scaffold, root exports, README pair, and public-surface tests for the fluo-native i18n package boundary.
