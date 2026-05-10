# @fluojs/terminus

## 1.0.0-beta.6

### Patch Changes

- [#1629](https://github.com/fluojs/fluo/pull/1629) [`758d1df`](https://github.com/fluojs/fluo/commit/758d1dfbe2d4c5de32077f832cbbbca957a271a4) Thanks [@ayden94](https://github.com/ayden94)! - Reject blank health indicator result keys as down diagnostics and lazy-load Node filesystem access so root Terminus imports stay runtime-safe. Node-specific memory/disk indicators are also available from the `@fluojs/terminus/node` subpath.

- [#1704](https://github.com/fluojs/fluo/pull/1704) [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f) Thanks [@ayden94](https://github.com/ayden94)! - Make Terminus Drizzle health checks lifecycle-aware by resolving the public Drizzle wrapper token before raw ping fallback, so shutdown and stopped Drizzle integrations now report unavailable health/readiness.

  Expose the `/ready` request context to runtime health readiness checks so integrations can resolve public runtime status providers without importing runtime internals.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`3465437`](https://github.com/fluojs/fluo/commit/3465437399e8e6ecdfca68fa8f5ccb02d5a9c52f), [`d9bff54`](https://github.com/fluojs/fluo/commit/d9bff543e337eaa7654fae5e25dcaef2784fa8d1), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`9f168b1`](https://github.com/fluojs/fluo/commit/9f168b1121760b8e32faee34332cc4590008fdff), [`b6f8754`](https://github.com/fluojs/fluo/commit/b6f8754e3d3247b29c412b5b5b20353ac60115a8), [`f1a94b2`](https://github.com/fluojs/fluo/commit/f1a94b2e184c8f4507294a826676d36b218a5bbb), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/drizzle@1.0.0-beta.4
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/prisma@1.0.0-beta.5
  - @fluojs/redis@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.5

### Patch Changes

- Updated dependencies [[`de78f42`](https://github.com/fluojs/fluo/commit/de78f42839c54af97369c37e6fc1cc7985b9f5fb)]:
  - @fluojs/prisma@1.0.0-beta.4

## 1.0.0-beta.4

### Patch Changes

- Updated dependencies [[`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299)]:
  - @fluojs/drizzle@1.0.0-beta.3
  - @fluojs/prisma@1.0.0-beta.3
  - @fluojs/redis@1.0.0-beta.3

## 1.0.0-beta.3

### Patch Changes

- Updated dependencies [[`01d5e65`](https://github.com/fluojs/fluo/commit/01d5e65f053db99704d9cb30585c75b94dd38367), [`1911e11`](https://github.com/fluojs/fluo/commit/1911e110e7dbb5296238ccc0a2e167ed6f34df86), [`16420f9`](https://github.com/fluojs/fluo/commit/16420f9055ca885a459522625f8ff605f0b109b6), [`ea08719`](https://github.com/fluojs/fluo/commit/ea08719da615cf60bcd6d9ac848c0d19f8ac538a), [`89f6379`](https://github.com/fluojs/fluo/commit/89f637935736c0fe9c52668a5b714c5c0e394af1), [`28ca2ef`](https://github.com/fluojs/fluo/commit/28ca2efb3d3464cc3573da5143924908146b459d)]:
  - @fluojs/http@1.0.0-beta.3
  - @fluojs/di@1.0.0-beta.4
  - @fluojs/prisma@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.4

## 1.0.0-beta.2

### Patch Changes

- [#1365](https://github.com/fluojs/fluo/pull/1365) [`967840a`](https://github.com/fluojs/fluo/commit/967840a02b6fee7dfcdb9b051cb83b0e62abe385) Thanks [@ayden94](https://github.com/ayden94)! - Harden Terminus health diagnostics so malformed indicator results and platform health/readiness failures remain visible as deterministic down contributors.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/drizzle@1.0.0-beta.2
  - @fluojs/redis@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
