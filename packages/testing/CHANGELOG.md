# @fluojs/testing

## [Unreleased]

## 2.0.0

### Major Changes

- [#2470](https://github.com/fluojs/fluo/pull/2470) [`ad586ec`](https://github.com/fluojs/fluo/commit/ad586ecf063083877282c1a77800ea4bf393ca2a) Thanks [@ayden94](https://github.com/ayden94)! - Narrow the root `@fluojs/testing` type surface to documented app/module testing contracts while keeping mock compatibility helpers available from `@fluojs/testing/types` and `@fluojs/testing/mock`.

  Migration: import low-level mock compatibility helper types such as `TestingMockFunction`, `TestingMockContext`, `TestingMockResult`, and `TestingMockSettledResult` from `@fluojs/testing/types` instead of the root package.

### Patch Changes

- [#2464](https://github.com/fluojs/fluo/pull/2464) [`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439) Thanks [@ayden94](https://github.com/ayden94)! - Refresh runtime platform telemetry from the active registry collect path so advanced shared-registry scrapers observe fresh component readiness and health series.

- [#2454](https://github.com/fluojs/fluo/pull/2454) [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100) Thanks [@ayden94](https://github.com/ayden94)! - Harden DI introspection snapshots and override stale-instance disposal ordering so framework-owned state cannot be observed through live maps and replacement resolution waits for stale teardown failures. Update testing module sync cache adoption to consume the snapshot introspection contract.

- [#2388](https://github.com/fluojs/fluo/pull/2388) [`64dec7f`](https://github.com/fluojs/fluo/commit/64dec7ff348544af6dfbe666b12f6f8d4d4f2195) Thanks [@ayden94](https://github.com/ayden94)! - Clarify `DeepMocked<T>` import surfaces and strengthen testing package regression coverage for createTestApp option forwarding, Vitest Babel config diagnostics, and portability cleanup failures.

- [#2302](https://github.com/fluojs/fluo/pull/2302) [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6) Thanks [@ayden94](https://github.com/ayden94)! - Harden DI request-scope lifecycle and introspection ownership by recursively disposing nested request scopes from their owners, returning read-only introspection state, and keeping testing cache adoption on controlled container-owned APIs.

  Migration note: callers that used `inspectResolutionState()` as a mutable escape hatch must stop mutating returned registration/cache maps or normalized provider records. Framework-owned tooling should use the returned `cacheOwner` helpers for controlled cache adoption instead of writing to the maps directly.

- [#2332](https://github.com/fluojs/fluo/pull/2332) [`8e0e43f`](https://github.com/fluojs/fluo/commit/8e0e43f7fa355aa9b804a9fb2833d29e1542a5c6) Thanks [@ayden94](https://github.com/ayden94)! - Keep Vitest mock-only declaration imports on the `@fluojs/testing/mock` boundary while preserving backward-compatible root `DeepMocked<T>` type imports through a Vitest-free structural mock type.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`344cec0`](https://github.com/fluojs/fluo/commit/344cec07b828af4d405efea3767302840edde19e), [`ec8ffb6`](https://github.com/fluojs/fluo/commit/ec8ffb605cf4b128fb2f7786a2a606b613530164), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/http@2.0.0
  - @fluojs/config@1.0.4
  - @fluojs/core@1.1.0

## 1.0.6

### Patch Changes

- [#2172](https://github.com/fluojs/fluo/pull/2172) [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451) Thanks [@ayden94](https://github.com/ayden94)! - Harden `overrideModule()` so testing module replacements preserve authored module identities without mutating source module metadata, add the runtime module replacement compile seam used by testing, and document the testing module, `createTestApp`, Vitest entrypoint, and NestJS migration contracts.

- [#2113](https://github.com/fluojs/fluo/pull/2113) [`1fab5ce`](https://github.com/fluojs/fluo/commit/1fab5ced669a02141c12760afc387ab88da1e1bf) Thanks [@ayden94](https://github.com/ayden94)! - Restrict the Vitest workspace alias helper to package exports so private source files are not exposed as importable `@fluojs/*` subpaths.

- [#2233](https://github.com/fluojs/fluo/pull/2233) [`b038b4c`](https://github.com/fluojs/fluo/commit/b038b4c6014a092c321289358a3f5e965d452461) Thanks [@ayden94](https://github.com/ayden94)! - Harden testing harness cleanup by closing platform conformance components after validation, diagnostics, and snapshot checks, making `createTestApp().close()` idempotent, and preserving cleanup failures for portability `run()` callbacks that surface a partially bootstrapped app.

- Updated dependencies [[`5d8fc23`](https://github.com/fluojs/fluo/commit/5d8fc23b199d4b617c6342f109c24e03970af9b4), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/http@1.1.2
  - @fluojs/runtime@1.1.8

## 1.0.5

### Patch Changes

- [#2053](https://github.com/fluojs/fluo/pull/2053) [`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1) Thanks [@ayden94](https://github.com/ayden94)! - Add an explicit DI container resolution-state introspection seam for framework testing helpers, remove HTTP portability startup-log assertions from global console monkey-patching, cache Vitest workspace alias scans per repository root, and harden testing package documentation and regression coverage.

- Updated dependencies [[`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1)]:
  - @fluojs/di@1.1.0
  - @fluojs/runtime@1.1.6

## 1.0.4

### Patch Changes

- [#2011](https://github.com/fluojs/fluo/pull/2011) [`4be19f0`](https://github.com/fluojs/fluo/commit/4be19f0e343e686ec84b5d15273e1b44241cbabb) Thanks [@ayden94](https://github.com/ayden94)! - Run testing-module bootstrap lifecycle hooks for singleton multi-provider contributions and document the Test namespace facade while covering createTestApp bootstrap option forwarding.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b)]:
  - @fluojs/runtime@1.1.2

## 1.0.3

### Patch Changes

- [#1990](https://github.com/fluojs/fluo/pull/1990) [`ca0e46a`](https://github.com/fluojs/fluo/commit/ca0e46afeb370eed4c64c7c9bdc5286f2f9d367b) Thanks [@ayden94](https://github.com/ayden94)! - Align testing module compilation and synchronous resolution with production lifecycle and DI ownership semantics.

- [#1992](https://github.com/fluojs/fluo/pull/1992) [`452bfb4`](https://github.com/fluojs/fluo/commit/452bfb44f80cb83d0f6bcf7aa6e333db07b4085f) Thanks [@ayden94](https://github.com/ayden94)! - Stabilize HTTP adapter portability tests by binding ephemeral ports directly, make the Deno adapter report actual `port: 0` listen targets before startup completes, document local Vitest peer installation, and publish the `@fluojs/testing/vitest/tooling` subpath with import regression coverage.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/http@1.1.0

## 1.0.2

### Patch Changes

- [#1848](https://github.com/fluojs/fluo/pull/1848) [`d3eabb0`](https://github.com/fluojs/fluo/commit/d3eabb070ea2d89375d1074c84784188c7093e4b) Thanks [@ayden94](https://github.com/ayden94)! - Harden portability and conformance harness cleanup so partially bootstrapped HTTP apps are closed after setup failures, web-runtime raw-body checks cover exact bytes, and diagnostics include actionable failure context.

- Updated dependencies [[`34c840f`](https://github.com/fluojs/fluo/commit/34c840f3a1cd15e0399aa91467201d5b8f85a988), [`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/config@1.0.1
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.1

## 1.0.0

### Patch Changes

- e22c645: Add Fastify coverage for the shared HTTP adapter portability harness and extend the harness to verify stream drain waiters settle when a response stream closes before a drain event.
- cf07bd7: Report portability harness cleanup failures explicitly while preserving primary assertion failures, and declare fetch-style platform test dependencies so conformance imports remain type-checked.
- aaab8c4: Harden `@fluojs/testing/vitest` module-id and Babel config portability, make HTTP portability harness assertions less flaky, and add a public `getModuleMetadata()` reader through the core root entrypoint so testing helpers avoid private internals.
- 00f4d90: Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

- 1b0fb6a: Preserve testing module identity during module overrides and align documented `createTestingModule` contracts with regression coverage.
- f6e90f0: Preserve `createTestApp(...)` bootstrap middleware/options and align synchronous `TestingModuleRef.get(...)` singleton instances with later async resolution.
- Updated dependencies [01d5e65]
- Updated dependencies [4fdb48c]
- Updated dependencies [72462e3]
- Updated dependencies [da003a1]
- Updated dependencies [c5aebdf]
- Updated dependencies [aa80042]
- Updated dependencies [372a80d]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [1d43614]
- Updated dependencies [2159d4f]
- Updated dependencies [f086fa5]
- Updated dependencies [288a0b1]
- Updated dependencies [33d51e1]
- Updated dependencies [1dda8b5]
- Updated dependencies [3f70169]
- Updated dependencies [1911e11]
- Updated dependencies [1b0a68a]
- Updated dependencies [e430e58]
- Updated dependencies [aaab8c4]
- Updated dependencies [93fc34b]
- Updated dependencies [a625716]
- Updated dependencies [45e0f1b]
- Updated dependencies [b82b28f]
- Updated dependencies [37ae1c5]
- Updated dependencies [48a9f97]
- Updated dependencies [16420f9]
- Updated dependencies [53a2b8e]
- Updated dependencies [e1bce3d]
- Updated dependencies [3baf5df]
- Updated dependencies [7b50db8]
- Updated dependencies [005d3d7]
- Updated dependencies [f8d05fa]
- Updated dependencies [00f4d90]
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
- Updated dependencies [28ca2ef]
- Updated dependencies [d4b7d48]
- Updated dependencies [dc8fff1]
- Updated dependencies [d3504c6]
- Updated dependencies [1f312e0]
  - @fluojs/http@1.0.0
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/config@1.0.0
  - @fluojs/di@1.0.0

## 1.0.0-beta.4

### Patch Changes

- [#1769](https://github.com/fluojs/fluo/pull/1769) [`cf07bd7`](https://github.com/fluojs/fluo/commit/cf07bd747c9a385db21868a1615c380faa96eaf8) Thanks [@ayden94](https://github.com/ayden94)! - Report portability harness cleanup failures explicitly while preserving primary assertion failures, and declare fetch-style platform test dependencies so conformance imports remain type-checked.

- Updated dependencies [[`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157), [`45e0f1b`](https://github.com/fluojs/fluo/commit/45e0f1bf877ba69544d93094d9c54657ea941e74), [`7b50db8`](https://github.com/fluojs/fluo/commit/7b50db85e95e2341f82d006f1e665c2bbcebeaa5)]:
  - @fluojs/core@1.0.0-beta.6
  - @fluojs/di@1.0.0-beta.8
  - @fluojs/http@1.0.0-beta.11

## 1.0.0-beta.3

### Patch Changes

- [#1692](https://github.com/fluojs/fluo/pull/1692) [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0) Thanks [@ayden94](https://github.com/ayden94)! - Harden `@fluojs/testing/vitest` module-id and Babel config portability, make HTTP portability harness assertions less flaky, and add a public `getModuleMetadata()` reader through the core root entrypoint so testing helpers avoid private internals.

- [#1640](https://github.com/fluojs/fluo/pull/1640) [`f6e90f0`](https://github.com/fluojs/fluo/commit/f6e90f0cd781d481b98976425273ea952a170100) Thanks [@ayden94](https://github.com/ayden94)! - Preserve `createTestApp(...)` bootstrap middleware/options and align synchronous `TestingModuleRef.get(...)` singleton instances with later async resolution.

- Updated dependencies [[`372a80d`](https://github.com/fluojs/fluo/commit/372a80d337f8b806f05693ed33ca45d6e4289115), [`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/config@1.0.0-beta.8
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.2

### Patch Changes

- [#1354](https://github.com/fluojs/fluo/pull/1354) [`e22c645`](https://github.com/fluojs/fluo/commit/e22c645f0ad78ec1e050db9f6b9d8e2479884959) Thanks [@ayden94](https://github.com/ayden94)! - Add Fastify coverage for the shared HTTP adapter portability harness and extend the harness to verify stream drain waiters settle when a response stream closes before a drain event.

- [#1349](https://github.com/fluojs/fluo/pull/1349) [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a) Thanks [@ayden94](https://github.com/ayden94)! - Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

- [#1364](https://github.com/fluojs/fluo/pull/1364) [`1b0fb6a`](https://github.com/fluojs/fluo/commit/1b0fb6a2ad3f0dfe8175b187453d43a03976c9f2) Thanks [@ayden94](https://github.com/ayden94)! - Preserve testing module identity during module overrides and align documented `createTestingModule` contracts with regression coverage.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/config@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
