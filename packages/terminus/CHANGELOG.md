# @fluojs/terminus

## [Unreleased]

### Patch Changes

- Harden health/readiness diagnostics so timed-out indicator probes do not overlap later checks for the same indicator instance, platform diagnostic keys preserve runtime payloads on user-key collisions, and Terminus docs/tests align with the runtime-owned endpoint contract.

## 1.1.0

### Minor Changes

- [#2473](https://github.com/fluojs/fluo/pull/2473) [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67) Thanks [@ayden94](https://github.com/ayden94)! - Expose the runtime health module readiness-registration contract and harden Terminus health/readiness optional-peer regression coverage for consumer-visible readiness composition seams.

### Patch Changes

- [#2340](https://github.com/fluojs/fluo/pull/2340) [`31d9a8e`](https://github.com/fluojs/fluo/commit/31d9a8ef71d78e0e6f6bb81216248ff1ded1220a) Thanks [@ayden94](https://github.com/ayden94)! - Harden Terminus health indicators by rejecting invalid indicator timeout budgets and cancelling HTTP probe response bodies after status checks.

- [#2393](https://github.com/fluojs/fluo/pull/2393) [`1e87363`](https://github.com/fluojs/fluo/commit/1e873635cf4d8af4c831aa96e5efbc9992f5fddd) Thanks [@ayden94](https://github.com/ayden94)! - Export the documented Terminus indicator-provider token, make Prisma health provider resolution prefer lifecycle-aware default or named Prisma service seams while retaining raw-client fallback and root optional-peer safety, and scope in-flight indicator serialization to each Terminus service/container.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/http@2.0.0
  - @fluojs/core@1.1.0

## 1.0.5

### Patch Changes

- [#2227](https://github.com/fluojs/fluo/pull/2227) [`54d99c4`](https://github.com/fluojs/fluo/commit/54d99c4ddb0318767a9fa774eb76bd895739e41b) Thanks [@ayden94](https://github.com/ayden94)! - Harden Terminus health/readiness diagnostics by preventing overlapping probes for the same timed-out indicator instance and preserving platform diagnostic payloads when user indicator keys collide with reserved platform keys.

- Updated dependencies [[`5d8fc23`](https://github.com/fluojs/fluo/commit/5d8fc23b199d4b617c6342f109c24e03970af9b4), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/http@1.1.2
  - @fluojs/runtime@1.1.8

## 1.0.4

### Patch Changes

- [#2050](https://github.com/fluojs/fluo/pull/2050) [`7228f64`](https://github.com/fluojs/fluo/commit/7228f64da296096ced9971b7926c2731d7177271) Thanks [@ayden94](https://github.com/ayden94)! - Clarify Terminus runtime-boundary documentation and route memory sampling through the Node runtime seam while preserving existing health indicator behavior.

- Updated dependencies [[`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1)]:
  - @fluojs/di@1.1.0
  - @fluojs/runtime@1.1.6

## 1.0.3

### Patch Changes

- [#1993](https://github.com/fluojs/fluo/pull/1993) [`d27a381`](https://github.com/fluojs/fluo/commit/d27a3810f7a0053ff490c21564f419af9f80e33f) Thanks [@ayden94](https://github.com/ayden94)! - Align Terminus Redis diagnostics and Metrics option responsibility contracts with lifecycle-aware tests, public documentation, and TSDoc coverage.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`778e748`](https://github.com/fluojs/fluo/commit/778e748b30ff272a3b9d013f71f0e807c4563b57), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`6e92478`](https://github.com/fluojs/fluo/commit/6e924781c31d4be551ec3f3a9a196a07dc637940), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/drizzle@1.0.1
  - @fluojs/http@1.1.0
  - @fluojs/prisma@1.0.1

## 1.0.2

### Patch Changes

- [#1871](https://github.com/fluojs/fluo/pull/1871) [`62ec07f`](https://github.com/fluojs/fluo/commit/62ec07f15abe872b47a6373832ff0deeba4dc6e6) Thanks [@ayden94](https://github.com/ayden94)! - Allow repeatable same-type Terminus indicator providers to coexist without DI token collisions and cover indicator timeout behavior through request-facing health/readiness endpoint tests.

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.1

## 1.0.0

### Patch Changes

- 758d1df: Reject blank health indicator result keys as down diagnostics and lazy-load Node filesystem access so root Terminus imports stay runtime-safe. Node-specific memory/disk indicators are also available from the `@fluojs/terminus/node` subpath.
- 967840a: Harden Terminus health diagnostics so malformed indicator results and platform health/readiness failures remain visible as deterministic down contributors.
- d3504c6: Make Terminus Drizzle health checks lifecycle-aware by resolving the public Drizzle wrapper token before raw ping fallback, so shutdown and stopped Drizzle integrations now report unavailable health/readiness.

  Expose the `/ready` request context to runtime health readiness checks so integrations can resolve public runtime status providers without importing runtime internals.

- Updated dependencies [01d5e65]
- Updated dependencies [4fdb48c]
- Updated dependencies [72462e3]
- Updated dependencies [da003a1]
- Updated dependencies [c5aebdf]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [1d43614]
- Updated dependencies [2159d4f]
- Updated dependencies [f086fa5]
- Updated dependencies [288a0b1]
- Updated dependencies [33d51e1]
- Updated dependencies [c5521e0]
- Updated dependencies [3465437]
- Updated dependencies [d9bff54]
- Updated dependencies [1dda8b5]
- Updated dependencies [3f70169]
- Updated dependencies [1911e11]
- Updated dependencies [1b0a68a]
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
- Updated dependencies [ea08719]
- Updated dependencies [9f168b1]
- Updated dependencies [49c22da]
- Updated dependencies [b6f8754]
- Updated dependencies [00f4d90]
- Updated dependencies [f1a94b2]
- Updated dependencies [ea86ded]
- Updated dependencies [de78f42]
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
- Updated dependencies [dc8fff1]
- Updated dependencies [d3504c6]
  - @fluojs/http@1.0.0
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/di@1.0.0
  - @fluojs/drizzle@1.0.0
  - @fluojs/prisma@1.0.0
  - @fluojs/redis@1.0.0

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
