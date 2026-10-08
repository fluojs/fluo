# @fluojs/auth-http

## [Unreleased]

## 0.2.0

### Minor Changes

- [#3931](https://github.com/fluojs/fluo/pull/3931) [`a719508`](https://github.com/fluojs/fluo/commit/a7195088aaaa787db909bcdb63e1fe31bf15bfa3) Thanks [@ayden94](https://github.com/ayden94)! - Separate transport-neutral identity, authentication results, strategies and account-linking policy into `@fluojs/auth`, and HTTP guards, registration, bearer, cookie and refresh integration into `@fluojs/auth-http`.

  Passport.js action binding remains in `@fluojs/passport`. Existing Passport, HTTP Principal and JWT JwtPrincipal imports remain compatible, including class tokens, metadata and versioned error identities. New applications use auth/auth-http as the canonical owners; JWT signing, verification and refresh rotation semantics are unchanged.

### Patch Changes

- Updated dependencies [[`a719508`](https://github.com/fluojs/fluo/commit/a7195088aaaa787db909bcdb63e1fe31bf15bfa3), [`a34789a`](https://github.com/fluojs/fluo/commit/a34789af807b87f134feb66f756ab1242946bf05), [`00525a8`](https://github.com/fluojs/fluo/commit/00525a81b37166889cbf9d742d5a7cc0ca2b92ef), [`6320fdd`](https://github.com/fluojs/fluo/commit/6320fdd52f40a9c3d2e5dca3694e84c17a6e1dcf), [`63920ab`](https://github.com/fluojs/fluo/commit/63920ab592ec57e39c3155906b0068de26238b5a), [`adedc3a`](https://github.com/fluojs/fluo/commit/adedc3a1f4dcdfde8c9325d063ce36cfbb5f5d7e), [`985dcd0`](https://github.com/fluojs/fluo/commit/985dcd0e532bc63d59253bafc0a9bf8cf73781f6), [`942f673`](https://github.com/fluojs/fluo/commit/942f673d34d58a9093d7012253913aec9143ff45), [`8f7c69d`](https://github.com/fluojs/fluo/commit/8f7c69d3c0c50b8a0cbd6abff51dba4d08e67991), [`12c47ae`](https://github.com/fluojs/fluo/commit/12c47ae9a3da31bc6a6d336ccfc6f5f61d11674d), [`8500d74`](https://github.com/fluojs/fluo/commit/8500d74bef6e4d9efbfd79087693d6258c7ff035)]:
  - @fluojs/auth@0.2.0
  - @fluojs/http@3.2.0
  - @fluojs/jwt@2.0.3
  - @fluojs/core@2.1.3
  - @fluojs/runtime@3.1.3
