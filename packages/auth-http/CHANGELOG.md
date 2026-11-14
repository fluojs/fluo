# @fluojs/auth-http

## [Unreleased]

## 0.2.1

### Patch Changes

- Updated dependencies [[`87b37b5`](https://github.com/fluojs/fluo/commit/87b37b5b33c15fea5197ed6c635d0e11cbe03b70), [`59e9955`](https://github.com/fluojs/fluo/commit/59e995560248a19533e1d0e4d58cf10ed57555e1), [`54dced9`](https://github.com/fluojs/fluo/commit/54dced97e2c87646f0ff1f782dea360ac3393e88), [`064609c`](https://github.com/fluojs/fluo/commit/064609ce31bf8aa8ed1eb9f1ae0852e67b2871ac), [`2a05748`](https://github.com/fluojs/fluo/commit/2a0574891d6de44b866b8ca337bf01d782bd5fde), [`ac7ce8d`](https://github.com/fluojs/fluo/commit/ac7ce8d09a0631ab993ca326a2680dd80fe30380), [`5b2a293`](https://github.com/fluojs/fluo/commit/5b2a293c49533e4f536c3328e255bf83df3c4c9d), [`1fe212d`](https://github.com/fluojs/fluo/commit/1fe212d4b49e6e2d1ef577d6ee62962e6da5bafb), [`93f2213`](https://github.com/fluojs/fluo/commit/93f22136266b93238c8db6a11160949867ce97ba), [`559fd2d`](https://github.com/fluojs/fluo/commit/559fd2df4c7a230a6bbdb4b89a23f1a5f8991f32), [`8817120`](https://github.com/fluojs/fluo/commit/8817120f21180ced38dda95b9fbbfb1133bb2a82), [`c0e0cb7`](https://github.com/fluojs/fluo/commit/c0e0cb7e67f07752c554a811a1d04e9e0e8f4337), [`7c3ded4`](https://github.com/fluojs/fluo/commit/7c3ded4f98f96ff702d3cf6466ef2e158045883e), [`31082f9`](https://github.com/fluojs/fluo/commit/31082f9e405d90edfea1646c60536316614bf7d1), [`d642f02`](https://github.com/fluojs/fluo/commit/d642f0281c34206b9684fe2bd116a9b230c29f0e), [`a436c3b`](https://github.com/fluojs/fluo/commit/a436c3b855f05087d04ef921e05eac9e53f7de93), [`b1a5604`](https://github.com/fluojs/fluo/commit/b1a5604c7b7430d239342c15446c9da26df48ab4), [`73d14ba`](https://github.com/fluojs/fluo/commit/73d14ba7f2b1e32976a2578d2904861c939a277d), [`b9c267d`](https://github.com/fluojs/fluo/commit/b9c267d1bf609f5f6d720ac9888f45d93c274ab8), [`a300bde`](https://github.com/fluojs/fluo/commit/a300bde7122ba41c39c25e101bd485a115538505), [`abc2046`](https://github.com/fluojs/fluo/commit/abc2046f13836b6972b188b06598998706ff3416), [`8f80684`](https://github.com/fluojs/fluo/commit/8f80684659d786b6866c6ac852c3ba0e8274c79e)]:
  - @fluojs/core@2.2.0
  - @fluojs/runtime@4.0.0
  - @fluojs/di@3.2.0
  - @fluojs/http@3.3.0
  - @fluojs/auth@0.2.1

## 0.2.0

### Minor Changes

- [#3931](https://github.com/fluojs/fluo/pull/3931) [`a719508`](https://github.com/fluojs/fluo/commit/a7195088aaaa787db909bcdb63e1fe31bf15bfa3) Thanks [@ayden94](https://github.com/ayden94)! - Separate transport-neutral identity, authentication results, strategies and account-linking policy into `@fluojs/auth`, and HTTP guards, registration, bearer, cookie and refresh integration into `@fluojs/auth-http`.

  Passport.js action binding remains in `@fluojs/passport`. Existing Passport, HTTP Principal and JWT JwtPrincipal imports remain compatible, including class tokens, metadata and versioned error identities. New applications use auth/auth-http as the canonical owners; JWT signing, verification and refresh rotation semantics are unchanged.

### Patch Changes

- [#3970](https://github.com/fluojs/fluo/pull/3970) [`aa0dadc`](https://github.com/fluojs/fluo/commit/aa0dadcc2c3d3221c76bda46e0ecf3915cac69a8) Thanks [@ayden94](https://github.com/ayden94)! - Clarify README prerequisites and distinguish application fragments from complete examples. Repair first-use examples, align English/Korean guidance and toolchain requirements, and separate deprecated Deno migration paths from new-project recommendations.

- Updated dependencies [[`364061e`](https://github.com/fluojs/fluo/commit/364061e43ae0e90e25b2fb71303ff60fa51976a2), [`ce70426`](https://github.com/fluojs/fluo/commit/ce70426f3bf29430c4eb941f8e94baaf8f78d364), [`a719508`](https://github.com/fluojs/fluo/commit/a7195088aaaa787db909bcdb63e1fe31bf15bfa3), [`a34789a`](https://github.com/fluojs/fluo/commit/a34789af807b87f134feb66f756ab1242946bf05), [`00525a8`](https://github.com/fluojs/fluo/commit/00525a81b37166889cbf9d742d5a7cc0ca2b92ef), [`6320fdd`](https://github.com/fluojs/fluo/commit/6320fdd52f40a9c3d2e5dca3694e84c17a6e1dcf), [`63920ab`](https://github.com/fluojs/fluo/commit/63920ab592ec57e39c3155906b0068de26238b5a), [`adedc3a`](https://github.com/fluojs/fluo/commit/adedc3a1f4dcdfde8c9325d063ce36cfbb5f5d7e), [`985dcd0`](https://github.com/fluojs/fluo/commit/985dcd0e532bc63d59253bafc0a9bf8cf73781f6), [`942f673`](https://github.com/fluojs/fluo/commit/942f673d34d58a9093d7012253913aec9143ff45), [`8f7c69d`](https://github.com/fluojs/fluo/commit/8f7c69d3c0c50b8a0cbd6abff51dba4d08e67991), [`12c47ae`](https://github.com/fluojs/fluo/commit/12c47ae9a3da31bc6a6d336ccfc6f5f61d11674d), [`aa0dadc`](https://github.com/fluojs/fluo/commit/aa0dadcc2c3d3221c76bda46e0ecf3915cac69a8), [`8500d74`](https://github.com/fluojs/fluo/commit/8500d74bef6e4d9efbfd79087693d6258c7ff035)]:
  - @fluojs/runtime@3.1.3
  - @fluojs/http@3.2.0
  - @fluojs/auth@0.2.0
  - @fluojs/jwt@2.0.3
  - @fluojs/core@2.1.3
  - @fluojs/di@3.1.3
