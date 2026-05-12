# @fluojs/jwt

## 1.0.0

### Minor Changes

- 72b1efe: Fix async `JwtModule.forRootAsync(...)` refresh-token export parity with the sync registration path, and keep `JwtService.verify(token, options)` on the shared JWKS/key-resolution cache when applying per-call verification overrides.
- d8d20d5: Add a durable refresh-token rotation store hook so replacement refresh tokens can be persisted atomically with consuming the previous token, and tighten JWT edge-case coverage for JWKS lookup, principal scope normalization, and typed failure codes.
- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- c9dae56: Reject non-finite JWT NumericDate claims and invalid `clockSkewSeconds` values during verification so malformed time policy fails closed.
- 397d7c6: Preserve fractional NumericDate precision for numeric per-call `JwtService.sign(..., { expiresIn })` values so short fractional TTLs no longer collapse to whole seconds.
- Updated dependencies [4fdb48c]
- Updated dependencies [da003a1]
- Updated dependencies [c5aebdf]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [1d43614]
- Updated dependencies [2159d4f]
- Updated dependencies [f086fa5]
- Updated dependencies [288a0b1]
- Updated dependencies [33d51e1]
- Updated dependencies [1911e11]
- Updated dependencies [1b0a68a]
- Updated dependencies [aaab8c4]
- Updated dependencies [93fc34b]
- Updated dependencies [37ae1c5]
- Updated dependencies [48a9f97]
- Updated dependencies [53a2b8e]
- Updated dependencies [005d3d7]
- Updated dependencies [f8d05fa]
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
- Updated dependencies [d3504c6]
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/di@1.0.0

## 1.0.0-beta.5

### Minor Changes

- [#1817](https://github.com/fluojs/fluo/pull/1817) [`d8d20d5`](https://github.com/fluojs/fluo/commit/d8d20d5ab28021d716994b5db9291de41e9a5be5) Thanks [@ayden94](https://github.com/ayden94)! - Add a durable refresh-token rotation store hook so replacement refresh tokens can be persisted atomically with consuming the previous token, and tighten JWT edge-case coverage for JWKS lookup, principal scope normalization, and typed failure codes.

### Patch Changes

- [#1759](https://github.com/fluojs/fluo/pull/1759) [`397d7c6`](https://github.com/fluojs/fluo/commit/397d7c6797d3960c65ce0499879fe3595fe834cf) Thanks [@ayden94](https://github.com/ayden94)! - Preserve fractional NumericDate precision for numeric per-call `JwtService.sign(..., { expiresIn })` values so short fractional TTLs no longer collapse to whole seconds.

- Updated dependencies [[`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157)]:
  - @fluojs/core@1.0.0-beta.6
  - @fluojs/di@1.0.0-beta.8

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
