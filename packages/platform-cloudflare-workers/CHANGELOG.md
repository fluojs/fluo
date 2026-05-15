# @fluojs/platform-cloudflare-workers

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
