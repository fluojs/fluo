# @fluojs/auth

## [Unreleased]

## 0.2.0

### Minor Changes

- [#3931](https://github.com/fluojs/fluo/pull/3931) [`a719508`](https://github.com/fluojs/fluo/commit/a7195088aaaa787db909bcdb63e1fe31bf15bfa3) Thanks [@ayden94](https://github.com/ayden94)! - Separate transport-neutral identity, authentication results, strategies and account-linking policy into `@fluojs/auth`, and HTTP guards, registration, bearer, cookie and refresh integration into `@fluojs/auth-http`.

  Passport.js action binding remains in `@fluojs/passport`. Existing Passport, HTTP Principal and JWT JwtPrincipal imports remain compatible, including class tokens, metadata and versioned error identities. New applications use auth/auth-http as the canonical owners; JWT signing, verification and refresh rotation semantics are unchanged.

### Patch Changes

- Updated dependencies [[`6320fdd`](https://github.com/fluojs/fluo/commit/6320fdd52f40a9c3d2e5dca3694e84c17a6e1dcf), [`8500d74`](https://github.com/fluojs/fluo/commit/8500d74bef6e4d9efbfd79087693d6258c7ff035)]:
  - @fluojs/core@2.1.3
