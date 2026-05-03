# @fluojs/di

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
