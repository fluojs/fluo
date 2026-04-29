# @fluojs/jwt

## 1.0.0-beta.2

### Minor Changes

- [#1427](https://github.com/fluojs/fluo/pull/1427) [`72b1efe`](https://github.com/fluojs/fluo/commit/72b1efe5452bc209168ffc65c8be37e10b1bc381) Thanks [@ayden94](https://github.com/ayden94)! - Fix async `JwtModule.forRootAsync(...)` refresh-token export parity with the sync registration path, and keep `JwtService.verify(token, options)` on the shared JWKS/key-resolution cache when applying per-call verification overrides.

### Patch Changes

- Updated dependencies [[`1911e11`](https://github.com/fluojs/fluo/commit/1911e110e7dbb5296238ccc0a2e167ed6f34df86), [`89f6379`](https://github.com/fluojs/fluo/commit/89f637935736c0fe9c52668a5b714c5c0e394af1)]:
  - @fluojs/di@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.4
