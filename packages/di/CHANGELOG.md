# @fluojs/di

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
