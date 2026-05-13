# @fluojs/core

## 1.0.1

### Patch Changes

- [#1840](https://github.com/fluojs/fluo/pull/1840) [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986) Thanks [@ayden94](https://github.com/ayden94)! - Preserve mapped DTO field metadata through documented subclassing patterns while preventing subset and partial DTO helpers from inheriting base class-level validators that depend on omitted or optional fields.

## 1.0.0

### Minor Changes

- fa0ecca: Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
- aaab8c4: Harden `@fluojs/testing/vitest` module-id and Babel config portability, make HTTP portability harness assertions less flaky, and add a public `getModuleMetadata()` reader through the core root entrypoint so testing helpers avoid private internals.

### Patch Changes

- 4fdb48c: Support Bun legacy decorator bundle output for HTTP route metadata while preserving the TC39 standard decorator metadata path.
- c5aebdf: Avoid installing the global `Symbol.metadata` polyfill as an import side effect; applications and tests should call `ensureMetadataSymbol()` at explicit bootstrap boundaries when they need the polyfill.
- 33987e4: Fix documented `@Inject(forwardRef(...))` and `@Inject(optional(...))` TypeScript compatibility by sharing wrapper-aware injection token types across core decorators and DI helpers.

## 1.0.0-beta.6

### Patch Changes

- [#1814](https://github.com/fluojs/fluo/pull/1814) [`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157) Thanks [@ayden94](https://github.com/ayden94)! - Fix documented `@Inject(forwardRef(...))` and `@Inject(optional(...))` TypeScript compatibility by sharing wrapper-aware injection token types across core decorators and DI helpers.

## 1.0.0-beta.5

### Minor Changes

- [#1692](https://github.com/fluojs/fluo/pull/1692) [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0) Thanks [@ayden94](https://github.com/ayden94)! - Harden `@fluojs/testing/vitest` module-id and Babel config portability, make HTTP portability harness assertions less flaky, and add a public `getModuleMetadata()` reader through the core root entrypoint so testing helpers avoid private internals.

## 1.0.0-beta.4

### Patch Changes

- [#1550](https://github.com/fluojs/fluo/pull/1550) [`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3) Thanks [@ayden94](https://github.com/ayden94)! - Support Bun legacy decorator bundle output for HTTP route metadata while preserving the TC39 standard decorator metadata path.

## 1.0.0-beta.3

### Patch Changes

- [#1510](https://github.com/fluojs/fluo/pull/1510) [`c5aebdf`](https://github.com/fluojs/fluo/commit/c5aebdfe141bda72a6701516c48ace0f5caf5ee2) Thanks [@ayden94](https://github.com/ayden94)! - Avoid installing the global `Symbol.metadata` polyfill as an import side effect; applications and tests should call `ensureMetadataSymbol()` at explicit bootstrap boundaries when they need the polyfill.

## 1.0.0-beta.2

### Minor Changes

- [#1380](https://github.com/fluojs/fluo/pull/1380) [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440) Thanks [@ayden94](https://github.com/ayden94)! - Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
