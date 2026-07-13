# @fluojs/platform-cloudflare-workers

## [Unreleased]

## 1.0.5

### Patch Changes

- [#2480](https://github.com/fluojs/fluo/pull/2480) [`aaabed1`](https://github.com/fluojs/fluo/commit/aaabed1ec13b1987a320fba535ad089371efe664) Thanks [@ayden94](https://github.com/ayden94)! - Align the Cloudflare Workers adapter public seam and lifecycle contract by keeping public Worker declarations on supported package barrels, freezing websocket binding ownership after the first listen boundary, and documenting shutdown/SSE/WebSocket drain behavior with regression coverage.

- [#2651](https://github.com/fluojs/fluo/pull/2651) [`2fb6dad`](https://github.com/fluojs/fluo/commit/2fb6dad36d2833d50c7995b51c09b7734f08de06) Thanks [@ayden94](https://github.com/ayden94)! - Keep Cloudflare Workers shutdown and `executionContext.waitUntil(...)` tracking active until upgraded server WebSockets close, and release SSE lifecycle tracking when synchronous reader or stream setup fails.

- [#2405](https://github.com/fluojs/fluo/pull/2405) [`8de6b9b`](https://github.com/fluojs/fluo/commit/8de6b9b1cf796c5a547e510d9dff4a30301d0d47) Thanks [@ayden94](https://github.com/ayden94)! - Stabilize Cloudflare Workers adapter lifecycle boundaries by rejecting live websocket binding mutation, preserving shutdown JSON responses for websocket upgrades during drains, and allowing lazy entrypoints to bootstrap again after a timed-out close eventually settles.

- [#2671](https://github.com/fluojs/fluo/pull/2671) [`0d47c74`](https://github.com/fluojs/fluo/commit/0d47c744630e6b2179c2be610110c1fd647db361) Thanks [@ayden94](https://github.com/ayden94)! - Regenerate the published Cloudflare Workers runtime and declarations from current source so Worker request context, WebSocket binding freeze and close tracking, SSE draining, and shutdown timeout recovery reach package consumers.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/http@2.0.0

## 1.0.4

### Patch Changes

- [#2254](https://github.com/fluojs/fluo/pull/2254) [`3640bc1`](https://github.com/fluojs/fluo/commit/3640bc1c96197c83d59887fb6e3c92e7f4c6d7e1) Thanks [@ayden94](https://github.com/ayden94)! - Attach Cloudflare Worker `env` and execution context to framework requests, and keep Worker `waitUntil`/shutdown drains open until SSE (`text/event-stream`) response bodies finish.

- Updated dependencies [[`5d8fc23`](https://github.com/fluojs/fluo/commit/5d8fc23b199d4b617c6342f109c24e03970af9b4), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/http@1.1.2
  - @fluojs/runtime@1.1.8

## 1.0.3

### Patch Changes

- [#2028](https://github.com/fluojs/fluo/pull/2028) [`625b8d4`](https://github.com/fluojs/fluo/commit/625b8d4229a9cfceae3e58d7b8cfc525bb0a56a7) Thanks [@ayden94](https://github.com/ayden94)! - Harden platform adapter option validation, shutdown lifecycle reuse, and contract documentation for Bun, Deno, Cloudflare Workers, Express, and Fastify.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b)]:
  - @fluojs/runtime@1.1.2

## 1.0.2

### Patch Changes

- [#1855](https://github.com/fluojs/fluo/pull/1855) [`b42c909`](https://github.com/fluojs/fluo/commit/b42c909a3679a1da6ad40e5b59f36bd72d55fbb5) Thanks [@ayden94](https://github.com/ayden94)! - Keep Cloudflare Worker websocket upgrades behind the same listen boundary as HTTP dispatch, return shutdown responses for follow-up requests after the adapter closes, and reject `listen()` with the Cloudflare Workers adapter shutdown-draining error while `close()` is still draining active requests.

- Updated dependencies [[`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2)]:
  - @fluojs/runtime@1.1.0

## 1.0.0

### Patch Changes

- 45e0f1b: Keep fetch-style platform adapter runtime imports off the HTTP root barrel and remove eager Node built-in imports from HTTP request-id/context helpers so edge bundles can instantiate without Node built-in shims.
- d772919: Document and test platform runtime edge contracts for native-route rematching, shutdown and body-size boundaries, Node.js portability harness coverage, and edge runtime conformance parity.
- c3ef937: Reuse shared Web request-response factories across adapter requests while preserving per-request body materialization and error/fallback response semantics.
- Updated dependencies [01d5e65]
- Updated dependencies [4fdb48c]
- Updated dependencies [72462e3]
- Updated dependencies [da003a1]
- Updated dependencies [fa0ecca]
- Updated dependencies [1dda8b5]
- Updated dependencies [3f70169]
- Updated dependencies [1b0a68a]
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
- Updated dependencies [d3504c6]
  - @fluojs/http@1.0.0
  - @fluojs/runtime@1.0.0

## 1.0.0-beta.4

### Patch Changes

- [#1764](https://github.com/fluojs/fluo/pull/1764) [`45e0f1b`](https://github.com/fluojs/fluo/commit/45e0f1bf877ba69544d93094d9c54657ea941e74) Thanks [@ayden94](https://github.com/ayden94)! - Keep fetch-style platform adapter runtime imports off the HTTP root barrel and remove eager Node built-in imports from HTTP request-id/context helpers so edge bundles can instantiate without Node built-in shims.

- Updated dependencies [[`45e0f1b`](https://github.com/fluojs/fluo/commit/45e0f1bf877ba69544d93094d9c54657ea941e74), [`7b50db8`](https://github.com/fluojs/fluo/commit/7b50db85e95e2341f82d006f1e665c2bbcebeaa5)]:
  - @fluojs/http@1.0.0-beta.11

## 1.0.0-beta.3

### Patch Changes

- [#1655](https://github.com/fluojs/fluo/pull/1655) [`d772919`](https://github.com/fluojs/fluo/commit/d7729192874146537a66e9947df2d454d8a93e64) Thanks [@ayden94](https://github.com/ayden94)! - Document and test platform runtime edge contracts for native-route rematching, shutdown and body-size boundaries, Node.js portability harness coverage, and edge runtime conformance parity.

- Updated dependencies [[`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.2

### Patch Changes

- [#1467](https://github.com/fluojs/fluo/pull/1467) [`c3ef937`](https://github.com/fluojs/fluo/commit/c3ef9375d83e9c3ee0e3caf52f6b3414c5b8e5d3) Thanks [@ayden94](https://github.com/ayden94)! - Reuse shared Web request-response factories across adapter requests while preserving per-request body materialization and error/fallback response semantics.

- Updated dependencies [[`c3ef937`](https://github.com/fluojs/fluo/commit/c3ef9375d83e9c3ee0e3caf52f6b3414c5b8e5d3)]:
  - @fluojs/runtime@1.0.0-beta.6
