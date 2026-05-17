# @fluojs/di

## 1.0.3

### Patch Changes

- [#1980](https://github.com/fluojs/fluo/pull/1980) [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8) Thanks [@ayden94](https://github.com/ayden94)! - Invalidate cached singleton and request-scope consumers when provider overrides replace one of their dependencies.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629)]:
  - @fluojs/core@1.0.3

## 1.0.2

### Patch Changes

- [#1837](https://github.com/fluojs/fluo/pull/1837) [`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad) Thanks [@ayden94](https://github.com/ayden94)! - Invalidate already-materialized request-scope child caches when parent or root providers are overridden so request-scoped resolutions cannot reuse stale instances after an override.

- Updated dependencies [[`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/core@1.0.1

## 1.0.0

### Minor Changes

- 288a0b1: Validate DI provider object shapes during registration and prevent request scopes from owning implicit singleton multi-provider registrations.

  Migration: consumers that registered default-scope multi providers directly on a request container must move those registrations to the root container before calling `createRequestScope()`. If the multi provider is intentionally request-local, declare it with `scope: 'request'`/`Scope.REQUEST`, or replace the request-local set with `override()` so the ownership boundary is explicit.

### Patch Changes

- 33987e4: Fix documented `@Inject(forwardRef(...))` and `@Inject(optional(...))` TypeScript compatibility by sharing wrapper-aware injection token types across core decorators and DI helpers.
- 1d43614: Preserve DI shutdown progress when request-scope child disposal fails, aggregate child/root disposal failures, and reject singleton dependency graphs that reach request scope through transient or factory providers.
- 2159d4f: Preserve every replacement passed to a multi-provider `override()` call and align DI circular-dependency guidance with the runtime `forwardRef()` contract.
- f086fa5: Cache DI provider resolution plans so repeated resolves and request-scope checks avoid redundant provider graph traversal without caching transient or request-scoped instances.
- 33d51e1: Cache forwardRef token lookups and avoid extra singleton cache traversal work on repeated DI resolutions.
- 1911e11: Lazily materialize request-scope container tracking and caches so singleton-only request paths avoid the fixed request-scope lifecycle overhead while preserving request-local isolation and disposal behavior.
- 35f60fd: Skip HTTP request-scope container creation for singleton-only routes while preserving isolated request-scoped DI whenever a controller graph, middleware, guard, interceptor, observer, DTO converter, or custom binder may require it.
- Updated dependencies [4fdb48c]
- Updated dependencies [c5aebdf]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [aaab8c4]
  - @fluojs/core@1.0.0

## 1.0.0-beta.8

### Patch Changes

- [#1814](https://github.com/fluojs/fluo/pull/1814) [`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157) Thanks [@ayden94](https://github.com/ayden94)! - Fix documented `@Inject(forwardRef(...))` and `@Inject(optional(...))` TypeScript compatibility by sharing wrapper-aware injection token types across core decorators and DI helpers.

- Updated dependencies [[`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157)]:
  - @fluojs/core@1.0.0-beta.6

## 1.0.0-beta.7

### Patch Changes

- [#1633](https://github.com/fluojs/fluo/pull/1633) [`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab) Thanks [@ayden94](https://github.com/ayden94)! - Preserve every replacement passed to a multi-provider `override()` call and align DI circular-dependency guidance with the runtime `forwardRef()` contract.

- Updated dependencies [[`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0)]:
  - @fluojs/core@1.0.0-beta.5

## 1.0.0-beta.6

### Patch Changes

- [#1502](https://github.com/fluojs/fluo/pull/1502) [`1d43614`](https://github.com/fluojs/fluo/commit/1d4361416e56ec935d67da096ba8b72d3886f7ee) Thanks [@ayden94](https://github.com/ayden94)! - Preserve DI shutdown progress when request-scope child disposal fails, aggregate child/root disposal failures, and reject singleton dependency graphs that reach request scope through transient or factory providers.

- [#1521](https://github.com/fluojs/fluo/pull/1521) [`f086fa5`](https://github.com/fluojs/fluo/commit/f086fa58827617bda8bdef50e0b694bd5e85dfaa) Thanks [@ayden94](https://github.com/ayden94)! - Cache DI provider resolution plans so repeated resolves and request-scope checks avoid redundant provider graph traversal without caching transient or request-scoped instances.

- Updated dependencies [[`c5aebdf`](https://github.com/fluojs/fluo/commit/c5aebdfe141bda72a6701516c48ace0f5caf5ee2)]:
  - @fluojs/core@1.0.0-beta.3

## 1.0.0-beta.5

### Patch Changes

- [#1458](https://github.com/fluojs/fluo/pull/1458) [`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f) Thanks [@ayden94](https://github.com/ayden94)! - Skip HTTP request-scope container creation for singleton-only routes while preserving isolated request-scoped DI whenever a controller graph, middleware, guard, interceptor, observer, DTO converter, or custom binder may require it.

## 1.0.0-beta.4

### Patch Changes

- [#1436](https://github.com/fluojs/fluo/pull/1436) [`1911e11`](https://github.com/fluojs/fluo/commit/1911e110e7dbb5296238ccc0a2e167ed6f34df86) Thanks [@ayden94](https://github.com/ayden94)! - Lazily materialize request-scope container tracking and caches so singleton-only request paths avoid the fixed request-scope lifecycle overhead while preserving request-local isolation and disposal behavior.

## 1.0.0-beta.3

### Patch Changes

- [#1381](https://github.com/fluojs/fluo/pull/1381) [`33d51e1`](https://github.com/fluojs/fluo/commit/33d51e163b2fc6d2cf43b820a91d0b95ee552e75) Thanks [@ayden94](https://github.com/ayden94)! - Cache forwardRef token lookups and avoid extra singleton cache traversal work on repeated DI resolutions.

- Updated dependencies [[`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440)]:
  - @fluojs/core@1.0.0-beta.2

## 1.0.0-beta.2

### Minor Changes

- [#1351](https://github.com/fluojs/fluo/pull/1351) [`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06) Thanks [@ayden94](https://github.com/ayden94)! - Validate DI provider object shapes during registration and prevent request scopes from owning implicit singleton multi-provider registrations.

  Migration: consumers that registered default-scope multi providers directly on a request container must move those registrations to the root container before calling `createRequestScope()`. If the multi provider is intentionally request-local, declare it with `scope: 'request'`/`Scope.REQUEST`, or replace the request-local set with `override()` so the ownership boundary is explicit.
