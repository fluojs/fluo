# @fluojs/i18n

## 2.0.0

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
