# @fluojs/jwt

## 1.0.0-beta.4

### Patch Changes

- [#1694](https://github.com/fluojs/fluo/pull/1694) [`c9dae56`](https://github.com/fluojs/fluo/commit/c9dae561fd2981f394ebd41f8ea15b17fe6a2ba8) Thanks [@ayden94](https://github.com/ayden94)! - Reject non-finite JWT NumericDate claims and invalid `clockSkewSeconds` values during verification so malformed time policy fails closed.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.3

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

## 1.0.0-beta.2

### Minor Changes

- [#1427](https://github.com/fluojs/fluo/pull/1427) [`72b1efe`](https://github.com/fluojs/fluo/commit/72b1efe5452bc209168ffc65c8be37e10b1bc381) Thanks [@ayden94](https://github.com/ayden94)! - Fix async `JwtModule.forRootAsync(...)` refresh-token export parity with the sync registration path, and keep `JwtService.verify(token, options)` on the shared JWKS/key-resolution cache when applying per-call verification overrides.

### Patch Changes

- Updated dependencies [[`1911e11`](https://github.com/fluojs/fluo/commit/1911e110e7dbb5296238ccc0a2e167ed6f34df86), [`89f6379`](https://github.com/fluojs/fluo/commit/89f637935736c0fe9c52668a5b714c5c0e394af1)]:
  - @fluojs/di@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.4
