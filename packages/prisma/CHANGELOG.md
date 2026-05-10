# @fluojs/prisma

## 1.0.0-beta.5

### Patch Changes

- [#1696](https://github.com/fluojs/fluo/pull/1696) [`9f168b1`](https://github.com/fluojs/fluo/commit/9f168b1121760b8e32faee34332cc4590008fdff) Thanks [@ayden94](https://github.com/ayden94)! - Ensure request-scoped transaction bookkeeping is released when Prisma transaction validation fails before the request transaction starts.

- [#1656](https://github.com/fluojs/fluo/pull/1656) [`b6f8754`](https://github.com/fluojs/fluo/commit/b6f8754e3d3247b29c412b5b5b20353ac60115a8) Thanks [@ayden94](https://github.com/ayden94)! - Clarify public Prisma DI tokens versus internal normalized module tokens, and document the nested transaction option guard with regression coverage.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`b15ac1b`](https://github.com/fluojs/fluo/commit/b15ac1bacccf53b39862ef0243182107840e9a3a), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`65a08db`](https://github.com/fluojs/fluo/commit/65a08db23814e2234bf5739fecf04f710b02a996), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/validation@1.0.0-beta.4
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.4

### Major Changes

- [#1571](https://github.com/fluojs/fluo/pull/1571) [`de78f42`](https://github.com/fluojs/fluo/commit/de78f42839c54af97369c37e6fc1cc7985b9f5fb) Thanks [@ayden94](https://github.com/ayden94)! - Remove the `PrismaModule.forName` and `PrismaModule.forNameAsync` convenience aliases. Register named Prisma clients through `PrismaModule.forRoot({ name, ... })` or `PrismaModule.forRootAsync({ name, ... })` instead.

## 1.0.0-beta.3

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

## 1.0.0-beta.2

### Minor Changes

- [#1421](https://github.com/fluojs/fluo/pull/1421) [`ea08719`](https://github.com/fluojs/fluo/commit/ea08719da615cf60bcd6d9ac848c0d19f8ac538a) Thanks [@ayden94](https://github.com/ayden94)! - Add explicit named PrismaModule registrations so one fluo application container can safely resolve multiple Prisma clients with isolated service, client, and options tokens.

### Patch Changes

- Updated dependencies [[`01d5e65`](https://github.com/fluojs/fluo/commit/01d5e65f053db99704d9cb30585c75b94dd38367), [`1911e11`](https://github.com/fluojs/fluo/commit/1911e110e7dbb5296238ccc0a2e167ed6f34df86), [`16420f9`](https://github.com/fluojs/fluo/commit/16420f9055ca885a459522625f8ff605f0b109b6), [`89f6379`](https://github.com/fluojs/fluo/commit/89f637935736c0fe9c52668a5b714c5c0e394af1), [`28ca2ef`](https://github.com/fluojs/fluo/commit/28ca2efb3d3464cc3573da5143924908146b459d)]:
  - @fluojs/http@1.0.0-beta.3
  - @fluojs/di@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.4
