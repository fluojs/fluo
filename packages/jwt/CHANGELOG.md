# @fluojs/jwt

## [Unreleased]

## 2.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#3563](https://github.com/fluojs/fluo/pull/3563) [`a3a302b`](https://github.com/fluojs/fluo/commit/a3a302bfa4fd80e6f246530ee5dd9cb09dbeaaad) Thanks [@ayden94](https://github.com/ayden94)! - Correct the shipped README contracts for JWT signing timestamps and `JwtService.verify()`.

  Migration: `JwtService.verify<T>(token, options)` returns the verified claim bag as `T`; it does not return a normalized `JwtPrincipal`. Consumers that need normalized `subject`, `roles`, `scopes`, `issuer`, `audience`, and `claims` must call `DefaultJwtVerifier.verifyAccessToken(token)` without per-call overrides, or `DefaultJwtVerifier.verifyAccessTokenWithOverrides(token, options)` when preserving per-call `algorithms`, `audience`, `issuer`, `clockSkewSeconds`, `maxAge`, or `requireExp`. Adapt callers that treated the `JwtService.verify(...)` result as a `JwtPrincipal`.

  This major release requires explicit maintainer approval.

### Minor Changes

- [#3499](https://github.com/fluojs/fluo/pull/3499) [`41698e7`](https://github.com/fluojs/fluo/commit/41698e71db25d0112a2601919376871c184fb330) Thanks [@ayden94](https://github.com/ayden94)! - Add a refresh-token-specific HMAC algorithm allowlist so asymmetric access-token policies can be kept narrow while refresh tokens remain independently configurable.

- [#3631](https://github.com/fluojs/fluo/pull/3631) [`df6737d`](https://github.com/fluojs/fluo/commit/df6737d3b53456f2c3491fbb596a74d7726ef33a) Thanks [@ayden94](https://github.com/ayden94)! - Add `RefreshTokenService.revokePresentedRefreshToken(...)` for safe single-session logout with a verified compact refresh token.

### Patch Changes

- [#3500](https://github.com/fluojs/fluo/pull/3500) [`4868425`](https://github.com/fluojs/fluo/commit/4868425d2409d96a4c33bff02c4751d706d00632) Thanks [@ayden94](https://github.com/ayden94)! - Remove the mandatory `@fluojs/runtime` dependency while preserving structural lifecycle and platform-status compatibility.

- [#3497](https://github.com/fluojs/fluo/pull/3497) [`a2f6930`](https://github.com/fluojs/fluo/commit/a2f6930e4ed987f85aca47458e11eac3e7d6e8c8) Thanks [@ayden94](https://github.com/ayden94)! - Normalize non-object JSON JWT headers and payloads to `JwtInvalidTokenError` instead of leaking raw runtime errors.

- [#3482](https://github.com/fluojs/fluo/pull/3482) [`c7cb10b`](https://github.com/fluojs/fluo/commit/c7cb10b7a569a6d476b51ebbf904b1ccbbfce65f) Thanks [@ayden94](https://github.com/ayden94)! - Reject empty or duplicate JWT key IDs before signing or verification can select ambiguous keys.

- [#3498](https://github.com/fluojs/fluo/pull/3498) [`c6e8353`](https://github.com/fluojs/fluo/commit/c6e83532360a7e375629376ef369b95f93112193) Thanks [@ayden94](https://github.com/ayden94)! - Keep JWT signer and verifier algorithm policies independent from mutable public hash lookup exports.

- [#3472](https://github.com/fluojs/fluo/pull/3472) [`1775f9f`](https://github.com/fluojs/fluo/commit/1775f9f9e0a11b564da9104086b7c390499c80e5) Thanks [@ayden94](https://github.com/ayden94)! - Restore the deprecated `createJwtCoreProviders(...)` root export for existing direct module composition callers.

- Updated dependencies [[`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0

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
