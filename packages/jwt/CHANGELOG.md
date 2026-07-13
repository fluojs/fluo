# @fluojs/jwt

## [Unreleased]

## 1.1.0

### Minor Changes

- [#2693](https://github.com/fluojs/fluo/pull/2693) [`7aa7da1`](https://github.com/fluojs/fluo/commit/7aa7da160663b840b321ffe4b19081e24e193e1d) Thanks [@ayden94](https://github.com/ayden94)! - Add optional family-scoped refresh-token revocation with a compatible subject-wide fallback, preserve consume-only rotation support, and align the Passport in-memory refresh store with the family contract.

### Patch Changes

- [#2457](https://github.com/fluojs/fluo/pull/2457) [`5401916`](https://github.com/fluojs/fluo/commit/540191624ff5099cf042280261ef6c7ef7f6c722) Thanks [@ayden94](https://github.com/ayden94)! - Abort active JWKS fetches when `JwksClient.dispose()` or `DefaultJwtVerifier.dispose()` clears retained JWKS key material during shutdown or identity-provider reconfiguration.

- [#2429](https://github.com/fluojs/fluo/pull/2429) [`5a04da1`](https://github.com/fluojs/fluo/commit/5a04da1cc272ff4a01df3649c5b820aa9ab6be78) Thanks [@ayden94](https://github.com/ayden94)! - Align `JwtModule.forRoot(...)` with async registration by exposing the `RefreshTokenService` provider/export surface even when sync options omit `refreshToken`, while preserving resolution-time configuration failure for callers that resolve the service without refresh-token options.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/core@1.1.0

## 1.0.3

### Patch Changes

- [#2109](https://github.com/fluojs/fluo/pull/2109) [`10b55fc`](https://github.com/fluojs/fluo/commit/10b55fc84db86805eba1d1e727fb579f03c3ee09) Thanks [@ayden94](https://github.com/ayden94)! - Dispose `JwtModule`-managed verifier JWKS caches during module shutdown and mark `normalizeRefreshTokenOptions(...)` as a deprecated root-import compatibility helper.

- Updated dependencies [[`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/runtime@1.1.8

## 1.0.2

### Patch Changes

- [#2074](https://github.com/fluojs/fluo/pull/2074) [`8c9d97a`](https://github.com/fluojs/fluo/commit/8c9d97a39cda8d2bb8b0cee9055cb5cb9c2cc417) Thanks [@ayden94](https://github.com/ayden94)! - Load Node.js crypto primitives lazily so the root `@fluojs/jwt` import surface no longer pulls `node:crypto` before callers execute signing, verification, JWKS key parsing, or refresh-token generation.

- Updated dependencies [[`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65)]:
  - @fluojs/runtime@1.1.7

## 1.0.1

### Patch Changes

- [#1981](https://github.com/fluojs/fluo/pull/1981) [`6c6eb9a`](https://github.com/fluojs/fluo/commit/6c6eb9a89afdacc17daf4153fbe0012e4d114cb1) Thanks [@ayden94](https://github.com/ayden94)! - Harden JWT expiry boundary handling and bound JWKS cache lifecycle semantics with explicit disposal support.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3

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
