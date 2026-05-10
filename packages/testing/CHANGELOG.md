# @fluojs/testing

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
