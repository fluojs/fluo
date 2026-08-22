# @fluojs/di

## [Unreleased]

## 3.0.0

### Major Changes

- [#3094](https://github.com/fluojs/fluo/pull/3094) [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7) Thanks [@ayden94](https://github.com/ayden94)! - Change container-managed shutdown from one-shot failed cleanup to retryable failed-hook disposal. In 2.x, a failed `onDestroy()` hook was attempted once. After upgrading to 3.x, a later explicit `Container.dispose()` call or application/application-context `close()` retries only failed hooks, while hooks that completed successfully remain exactly-once. Consumers must make failing cleanup hooks safe to attempt again.

  Direct child disposal now detaches the child from its parent after the attempt settles, including failed attempts. A caller that retains the child reference may retry its failed hooks. Parent- or root-started failures remain owned by the parent hierarchy until cleanup succeeds or a later direct child attempt settles.

### Patch Changes

- [#3011](https://github.com/fluojs/fluo/pull/3011) [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406) Thanks [@ayden94](https://github.com/ayden94)! - Keep nested request-scope overrides owned and cached by their nearest request scope instead of leaking request-local instances into root singleton caches.

- [#2977](https://github.com/fluojs/fluo/pull/2977) [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf) Thanks [@ayden94](https://github.com/ayden94)! - Dispose cached single and multi-provider instances together in reverse materialization order so dependents shut down before their dependencies.

- [#2823](https://github.com/fluojs/fluo/pull/2823) [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9) Thanks [@ayden94](https://github.com/ayden94)! - Reject cycles across pending singleton and request-scoped resolutions, and prevent request-scope overrides from introducing new singleton providers.

- [#2980](https://github.com/fluojs/fluo/pull/2980) [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4) Thanks [@ayden94](https://github.com/ayden94)! - Reject malformed `provide` and `useExisting` provider tokens during registration with `InvalidProviderError`.

- [#2882](https://github.com/fluojs/fluo/pull/2882) [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d) Thanks [@ayden94](https://github.com/ayden94)! - Reject value providers that declare `inject` metadata instead of silently discarding the invalid dependency declaration.

- Updated dependencies [[`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317)]:
  - @fluojs/core@1.1.1

## 2.0.0

### Major Changes

- [#2302](https://github.com/fluojs/fluo/pull/2302) [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6) Thanks [@ayden94](https://github.com/ayden94)! - Harden DI request-scope lifecycle and introspection ownership by recursively disposing nested request scopes from their owners, returning read-only introspection state, and keeping testing cache adoption on controlled container-owned APIs.

  Migration note: callers that used `inspectResolutionState()` as a mutable escape hatch must stop mutating returned registration/cache maps or normalized provider records. Framework-owned tooling should use the returned `cacheOwner` helpers for controlled cache adoption instead of writing to the maps directly.

### Patch Changes

- [#2645](https://github.com/fluojs/fluo/pull/2645) [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa) Thanks [@ayden94](https://github.com/ayden94)! - Ensure provider replacement resolution waits for stale instance disposal across materialized descendant request scopes and propagates descendant disposal failures consistently.

- [#2454](https://github.com/fluojs/fluo/pull/2454) [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100) Thanks [@ayden94](https://github.com/ayden94)! - Harden DI introspection snapshots and override stale-instance disposal ordering so framework-owned state cannot be observed through live maps and replacement resolution waits for stale teardown failures. Update testing module sync cache adoption to consume the snapshot introspection contract.

- [#2665](https://github.com/fluojs/fluo/pull/2665) [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff) Thanks [@ayden94](https://github.com/ayden94)! - Normalize malformed provider `inject` arrays, dependency wrappers, and `scope` values to structured `InvalidProviderError` failures during direct registration and module-graph compilation while preserving class `@Inject(...)` metadata fallback for omitted or `undefined` `inject` values.

- [#2648](https://github.com/fluojs/fluo/pull/2648) [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925) Thanks [@ayden94](https://github.com/ayden94)! - Restore the governed `Unreleased` changelog placeholder for foundation packages and preserve it when Changesets generates future package versions.

- Updated dependencies [[`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/core@1.1.0

## 1.1.0

### Minor Changes

- [#2053](https://github.com/fluojs/fluo/pull/2053) [`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1) Thanks [@ayden94](https://github.com/ayden94)! - Add an explicit DI container resolution-state introspection seam for framework testing helpers, remove HTTP portability startup-log assertions from global console monkey-patching, cache Vitest workspace alias scans per repository root, and harden testing package documentation and regression coverage.

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
