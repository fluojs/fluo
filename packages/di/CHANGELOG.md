# @fluojs/di

## 1.0.0-beta.2

### Minor Changes

- [#1351](https://github.com/fluojs/fluo/pull/1351) [`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06) Thanks [@ayden94](https://github.com/ayden94)! - Validate DI provider object shapes during registration and prevent request scopes from owning implicit singleton multi-provider registrations.

  Migration: consumers that registered default-scope multi providers directly on a request container must move those registrations to the root container before calling `createRequestScope()`. If the multi provider is intentionally request-local, declare it with `scope: 'request'`/`Scope.REQUEST`, or replace the request-local set with `override()` so the ownership boundary is explicit.
