# @fluojs/platform-nodejs

## 1.0.1

### Patch Changes

- [#1856](https://github.com/fluojs/fluo/pull/1856) [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2) Thanks [@ayden94](https://github.com/ayden94)! - Harden the Node.js platform contract by validating lifecycle retry/shutdown options, preserving `x-correlation-id` as the request ID fallback on Node-backed requests, and documenting package-local coverage for listen retry and keep-alive shutdown behavior.

- Updated dependencies [[`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2)]:
  - @fluojs/runtime@1.0.1

## 1.0.0

### Patch Changes

- 1b0a68a: Optimize Node-backed request shell creation so Express, Fastify, and raw Node adapters reuse host-parsed request data where possible without changing query, body, raw body, multipart, or native route handoff behavior.
- 48a9f97: Fix the raw Node adapter to recognize mixed-case JSON and multipart content types, and fail fast when `maxBodySize` is configured with a non-numeric value instead of byte-count input.
- 7105f5f: Align the Node.js adapter public docs, TSDoc, and portability regression coverage for the documented startup helpers, type aliases, and HTTP adapter conformance expectations.
- d772919: Document and test platform runtime edge contracts for native-route rematching, shutdown and body-size boundaries, Node.js portability harness coverage, and edge runtime conformance parity.
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

## 1.0.0-beta.5

### Patch Changes

- [#1655](https://github.com/fluojs/fluo/pull/1655) [`d772919`](https://github.com/fluojs/fluo/commit/d7729192874146537a66e9947df2d454d8a93e64) Thanks [@ayden94](https://github.com/ayden94)! - Document and test platform runtime edge contracts for native-route rematching, shutdown and body-size boundaries, Node.js portability harness coverage, and edge runtime conformance parity.

- Updated dependencies [[`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.4

### Patch Changes

- [#1477](https://github.com/fluojs/fluo/pull/1477) [`1b0a68a`](https://github.com/fluojs/fluo/commit/1b0a68a1537ebd508f7dcefac92be97cbd20b84b) Thanks [@ayden94](https://github.com/ayden94)! - Optimize Node-backed request shell creation so Express, Fastify, and raw Node adapters reuse host-parsed request data where possible without changing query, body, raw body, multipart, or native route handoff behavior.

- Updated dependencies [[`1b0a68a`](https://github.com/fluojs/fluo/commit/1b0a68a1537ebd508f7dcefac92be97cbd20b84b), [`e1bce3d`](https://github.com/fluojs/fluo/commit/e1bce3d758794b5a58704f5ccda7e0bf4aed01f0), [`3baf5df`](https://github.com/fluojs/fluo/commit/3baf5dfc1e09d95f4869cd7d847b545c49609ed7), [`005d3d7`](https://github.com/fluojs/fluo/commit/005d3d78dd490ee9278bb5a736572d327ab7d3dc)]:
  - @fluojs/runtime@1.0.0-beta.7
  - @fluojs/http@1.0.0-beta.5

## 1.0.0-beta.3

### Patch Changes

- [#1452](https://github.com/fluojs/fluo/pull/1452) [`48a9f97`](https://github.com/fluojs/fluo/commit/48a9f9761c093e6622922719869a29a84f7d0079) Thanks [@ayden94](https://github.com/ayden94)! - Fix the raw Node adapter to recognize mixed-case JSON and multipart content types, and fail fast when `maxBodySize` is configured with a non-numeric value instead of byte-count input.

- Updated dependencies [[`72462e3`](https://github.com/fluojs/fluo/commit/72462e34b4e5f41ff46ca8a98dce2f35d0ead5a0), [`48a9f97`](https://github.com/fluojs/fluo/commit/48a9f9761c093e6622922719869a29a84f7d0079), [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27), [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946), [`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f)]:
  - @fluojs/http@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.5

## 1.0.0-beta.2

### Patch Changes

- [#1359](https://github.com/fluojs/fluo/pull/1359) [`7105f5f`](https://github.com/fluojs/fluo/commit/7105f5ffdd3ff3de8dfb66b885d2f5b4c2caaa46) Thanks [@ayden94](https://github.com/ayden94)! - Align the Node.js adapter public docs, TSDoc, and surface regression coverage for the documented startup helpers and type aliases.

- Updated dependencies [[`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/runtime@1.0.0-beta.2
