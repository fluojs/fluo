# @fluojs/platform-express

## [Unreleased]

## 1.1.1

### Patch Changes

- [#2770](https://github.com/fluojs/fluo/pull/2770) [`6edaaa0`](https://github.com/fluojs/fluo/commit/6edaaa05202635a86cc64bd83453983ed239fa12) Thanks [@ayden94](https://github.com/ayden94)! - Type `ExpressHttpApplicationAdapter.getServer()` as its Node HTTP/HTTPS server union.

- Updated dependencies [[`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4)]:
  - @fluojs/runtime@2.0.2

## 1.1.0

### Minor Changes

- [#2672](https://github.com/fluojs/fluo/pull/2672) [`6765ea3`](https://github.com/fluojs/fluo/commit/6765ea3ea4009aec1e4f91592e93f87676522aae) Thanks [@ayden94](https://github.com/ayden94)! - Add an explicit pre-router `nativeMiddleware` option for retaining Express/Connect handlers during platform-specific migrations, with documented ordering, response termination, error propagation, and resource ownership.

### Patch Changes

- [#2397](https://github.com/fluojs/fluo/pull/2397) [`c8cf2c3`](https://github.com/fluojs/fluo/commit/c8cf2c3875c09d2626158c4c8c15799f7f51e5af) Thanks [@ayden94](https://github.com/ayden94)! - Make duplicate Express adapter `listen()` calls idempotent while preserving the live dispatcher, and document the SSE and lifecycle contract alongside regression coverage for retry exhaustion, idle keep-alive drain, and native-route fallback parity.

- [#2649](https://github.com/fluojs/fluo/pull/2649) [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4) Thanks [@ayden94](https://github.com/ayden94)! - Remove the Node.js `Buffer` dependency from Web multipart parsing and expose uploaded file payloads as runtime-neutral `Uint8Array` values.

  Preserve Buffer-backed multipart file payloads at the Express Node adapter boundary.

  Node-only consumers that use Buffer-specific methods must convert explicitly at their application boundary with `Buffer.from(file.buffer)`.

- [#2467](https://github.com/fluojs/fluo/pull/2467) [`1915663`](https://github.com/fluojs/fluo/commit/191566313f6def73c9051471596448bfbd0ee577) Thanks [@ayden94](https://github.com/ayden94)! - Cancel and join in-flight Express adapter listen retry loops during `close()` so a busy-port startup cannot bind after shutdown has already resolved.

- [#2643](https://github.com/fluojs/fluo/pull/2643) [`3fe2b56`](https://github.com/fluojs/fluo/commit/3fe2b563802f69be68bdb7079fc4bfc67720bb3b) Thanks [@ayden94](https://github.com/ayden94)! - Reuse one in-flight Express listen lifecycle and reject startup during close so delayed retries cannot outlive shutdown.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/http@2.0.0

## 1.0.6

### Patch Changes

- [#2086](https://github.com/fluojs/fluo/pull/2086) [`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65) Thanks [@ayden94](https://github.com/ayden94)! - Keep the runtime internal HTTP adapter seam free of Node-specific console logger globals, and route platform defaults through either the transport-neutral logger or the explicit Node runtime subpath.

- Updated dependencies [[`06f35cb`](https://github.com/fluojs/fluo/commit/06f35cbef3a0343a6745e658c120eb19d15d4480), [`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65)]:
  - @fluojs/http@1.1.1
  - @fluojs/runtime@1.1.7

## 1.0.5

### Patch Changes

- [#2053](https://github.com/fluojs/fluo/pull/2053) [`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1) Thanks [@ayden94](https://github.com/ayden94)! - Add an explicit DI container resolution-state introspection seam for framework testing helpers, remove HTTP portability startup-log assertions from global console monkey-patching, cache Vitest workspace alias scans per repository root, and harden testing package documentation and regression coverage.

- Updated dependencies [[`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1)]:
  - @fluojs/runtime@1.1.6

## 1.0.4

### Patch Changes

- [#2038](https://github.com/fluojs/fluo/pull/2038) [`4403acd`](https://github.com/fluojs/fluo/commit/4403acdf90ed3335895c4eb43a304161476cff57) Thanks [@ayden94](https://github.com/ayden94)! - Restore generated Node starter runtime log colors by using platform startup helpers and internalizing runtime logger selection instead of accepting logger overrides in app options.

- Updated dependencies [[`4403acd`](https://github.com/fluojs/fluo/commit/4403acdf90ed3335895c4eb43a304161476cff57)]:
  - @fluojs/runtime@1.1.5

## 1.0.3

### Patch Changes

- [#2028](https://github.com/fluojs/fluo/pull/2028) [`625b8d4`](https://github.com/fluojs/fluo/commit/625b8d4229a9cfceae3e58d7b8cfc525bb0a56a7) Thanks [@ayden94](https://github.com/ayden94)! - Harden platform adapter option validation, shutdown lifecycle reuse, and contract documentation for Bun, Deno, Cloudflare Workers, Express, and Fastify.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b)]:
  - @fluojs/runtime@1.1.2

## 1.0.2

### Patch Changes

- [#1857](https://github.com/fluojs/fluo/pull/1857) [`a680f3a`](https://github.com/fluojs/fluo/commit/a680f3a4814b94184048847d88cb740aa28235e0) Thanks [@ayden94](https://github.com/ayden94)! - Validate Express adapter numeric options during setup and align Express runtime docs with the supported server/shutdown contract.

- Updated dependencies [[`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2)]:
  - @fluojs/runtime@1.1.0

## 1.0.0

### Patch Changes

- 3f70169: Route semantically safe Express native matches through the shared dispatcher native fast path when eligible while preserving full dispatcher fallback, body materialization, error handling, and documented route fallback semantics. Synthetic dispatch requests also preserve request extension data so testing helpers can continue injecting principals into `RequestContext`.
- 8694b9f: Fix Express response stream backpressure waits so `waitForDrain()` settles when the connection drains, closes, or errors instead of hanging on disconnected clients.
- 1b0a68a: Optimize Node-backed request shell creation so Express, Fastify, and raw Node adapters reuse host-parsed request data where possible without changing query, body, raw body, multipart, or native route handoff behavior.
- fa11273: Preserve fluo routing semantics while letting the Express adapter pre-register safe per-method router entries for explicit routes and fall back to catch-all dispatch for overlapping param shapes, `@All(...)` handlers, and normalization-sensitive requests.
- 53a2b8e: Avoid duplicate route matching when semantically safe adapter-native routes hand a pre-matched descriptor into the shared `@fluojs/http` dispatcher.

  Keep `@All(...)`, same-shape params, normalization-sensitive paths, `OPTIONS`/CORS ownership, and versioning-sensitive routes on the generic fallback path so adapter portability contracts stay unchanged.

- d772919: Document and test platform runtime edge contracts for native-route rematching, shutdown and body-size boundaries, Node.js portability harness coverage, and edge runtime conformance parity.
- 00f4d90: Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

- 69936b1: Add a conservative fast path for successful object and array JSON responses while preserving existing formatter, streaming, redirect, binary, string, header, status, and error semantics.
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

## 1.0.0-beta.7

### Patch Changes

- [#1655](https://github.com/fluojs/fluo/pull/1655) [`d772919`](https://github.com/fluojs/fluo/commit/d7729192874146537a66e9947df2d454d8a93e64) Thanks [@ayden94](https://github.com/ayden94)! - Document and test platform runtime edge contracts for native-route rematching, shutdown and body-size boundaries, Node.js portability harness coverage, and edge runtime conformance parity.

- Updated dependencies [[`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.6

### Patch Changes

- [#1483](https://github.com/fluojs/fluo/pull/1483) [`3f70169`](https://github.com/fluojs/fluo/commit/3f70169c25e9cc04db6d01e7d4b17572d9174102) Thanks [@ayden94](https://github.com/ayden94)! - Route semantically safe Express native matches through the shared dispatcher native fast path when eligible while preserving full dispatcher fallback, body materialization, error handling, and documented route fallback semantics. Synthetic dispatch requests also preserve request extension data so testing helpers can continue injecting principals into `RequestContext`.

- Updated dependencies [[`3f70169`](https://github.com/fluojs/fluo/commit/3f70169c25e9cc04db6d01e7d4b17572d9174102)]:
  - @fluojs/http@1.0.0-beta.7

## 1.0.0-beta.5

### Patch Changes

- [#1477](https://github.com/fluojs/fluo/pull/1477) [`1b0a68a`](https://github.com/fluojs/fluo/commit/1b0a68a1537ebd508f7dcefac92be97cbd20b84b) Thanks [@ayden94](https://github.com/ayden94)! - Optimize Node-backed request shell creation so Express, Fastify, and raw Node adapters reuse host-parsed request data where possible without changing query, body, raw body, multipart, or native route handoff behavior.

- Updated dependencies [[`1b0a68a`](https://github.com/fluojs/fluo/commit/1b0a68a1537ebd508f7dcefac92be97cbd20b84b), [`e1bce3d`](https://github.com/fluojs/fluo/commit/e1bce3d758794b5a58704f5ccda7e0bf4aed01f0), [`3baf5df`](https://github.com/fluojs/fluo/commit/3baf5dfc1e09d95f4869cd7d847b545c49609ed7), [`005d3d7`](https://github.com/fluojs/fluo/commit/005d3d78dd490ee9278bb5a736572d327ab7d3dc)]:
  - @fluojs/runtime@1.0.0-beta.7
  - @fluojs/http@1.0.0-beta.5

## 1.0.0-beta.4

### Patch Changes

- [#1453](https://github.com/fluojs/fluo/pull/1453) [`8694b9f`](https://github.com/fluojs/fluo/commit/8694b9f5754b60a6f18b4db40e2b0ae06958e5c4) Thanks [@ayden94](https://github.com/ayden94)! - Fix Express response stream backpressure waits so `waitForDrain()` settles when the connection drains, closes, or errors instead of hanging on disconnected clients.

- [#1454](https://github.com/fluojs/fluo/pull/1454) [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27) Thanks [@ayden94](https://github.com/ayden94)! - Avoid duplicate route matching when semantically safe adapter-native routes hand a pre-matched descriptor into the shared `@fluojs/http` dispatcher.

  Keep `@All(...)`, same-shape params, normalization-sensitive paths, `OPTIONS`/CORS ownership, and versioning-sensitive routes on the generic fallback path so adapter portability contracts stay unchanged.

- [#1459](https://github.com/fluojs/fluo/pull/1459) [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946) Thanks [@ayden94](https://github.com/ayden94)! - Add a conservative fast path for successful object and array JSON responses while preserving existing formatter, streaming, redirect, binary, string, header, status, and error semantics.

- Updated dependencies [[`72462e3`](https://github.com/fluojs/fluo/commit/72462e34b4e5f41ff46ca8a98dce2f35d0ead5a0), [`48a9f97`](https://github.com/fluojs/fluo/commit/48a9f9761c093e6622922719869a29a84f7d0079), [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27), [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946), [`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f)]:
  - @fluojs/http@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.5

## 1.0.0-beta.3

### Patch Changes

- [#1443](https://github.com/fluojs/fluo/pull/1443) [`fa11273`](https://github.com/fluojs/fluo/commit/fa11273123cc8e5fa94161c3f66949bbbdcbaebd) Thanks [@ayden94](https://github.com/ayden94)! - Preserve fluo routing semantics while letting the Express adapter pre-register safe per-method router entries for explicit routes and fall back to catch-all dispatch for overlapping param shapes, `@All(...)` handlers, and normalization-sensitive requests.

- Updated dependencies [[`01d5e65`](https://github.com/fluojs/fluo/commit/01d5e65f053db99704d9cb30585c75b94dd38367), [`16420f9`](https://github.com/fluojs/fluo/commit/16420f9055ca885a459522625f8ff605f0b109b6), [`89f6379`](https://github.com/fluojs/fluo/commit/89f637935736c0fe9c52668a5b714c5c0e394af1), [`28ca2ef`](https://github.com/fluojs/fluo/commit/28ca2efb3d3464cc3573da5143924908146b459d)]:
  - @fluojs/http@1.0.0-beta.3
  - @fluojs/runtime@1.0.0-beta.4

## 1.0.0-beta.2

### Patch Changes

- [#1349](https://github.com/fluojs/fluo/pull/1349) [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a) Thanks [@ayden94](https://github.com/ayden94)! - Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

- Updated dependencies [[`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/runtime@1.0.0-beta.2
