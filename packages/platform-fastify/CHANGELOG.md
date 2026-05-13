# @fluojs/platform-fastify

## 1.0.1

### Patch Changes

- [#1859](https://github.com/fluojs/fluo/pull/1859) [`5607dc0`](https://github.com/fluojs/fluo/commit/5607dc020c7e62fb1f3c0e64b0125df6abdf7f4a) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Fastify raw-body portability and body-limit enforcement under the shared HTTP adapter harness.

- Updated dependencies [[`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2)]:
  - @fluojs/runtime@1.0.1

## 1.0.0

### Patch Changes

- 185487f: Expand CLI automation outputs for generation, inspection, migration, scaffolding, and generator metadata.

  Expose Studio-owned snapshot-to-Mermaid rendering helpers and platform snapshot types.

  Refresh the published Fastify adapter dependency metadata to fastify@^5.8.5.

- a17bd5f: Preserve `FrameworkRequest.rawBody` as the exact original bytes in the Fastify adapter when `rawBody: true` is enabled for non-multipart requests.
- 6130e63: Reduce Fastify adapter request and response hot-path overhead while preserving request headers, query, cookie, raw-body, multipart, streaming, and abort behavior.
- e22c645: Add Fastify coverage for the shared HTTP adapter portability harness and extend the harness to verify stream drain waiters settle when a response stream closes before a drain event.
- 1b0a68a: Optimize Node-backed request shell creation so Express, Fastify, and raw Node adapters reuse host-parsed request data where possible without changing query, body, raw body, multipart, or native route handoff behavior.
- 37ae1c5: Add conservative HTTP fast-path execution and native route handoff optimizations for singleton-safe routes while preserving middleware, guards, pipes, interceptors, error handling, adapter fallback, raw-body, multipart, streaming, abort, and request-scope behavior.
- 16420f9: Improve `@fluojs/platform-fastify` request dispatch by registering Fastify-native per-route handlers when fluo route metadata can be translated safely, while keeping wildcard fallback behavior for unmatched requests.

  Preserve fluo route semantics for params, versioning, middleware/guard/interceptor/observer lifecycle, error handling, SSE, multipart, raw body, and streaming with regression coverage for native route selection.

- 53a2b8e: Avoid duplicate route matching when semantically safe adapter-native routes hand a pre-matched descriptor into the shared `@fluojs/http` dispatcher.

  Keep `@All(...)`, same-shape params, normalization-sensitive paths, `OPTIONS`/CORS ownership, and versioning-sensitive routes on the generic fallback path so adapter portability contracts stay unchanged.

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

## 1.0.0-beta.8

### Patch Changes

- [#1480](https://github.com/fluojs/fluo/pull/1480) [`37ae1c5`](https://github.com/fluojs/fluo/commit/37ae1c594e0a2330cae10faddb350cd2a039643c) Thanks [@ayden94](https://github.com/ayden94)! - Add conservative HTTP fast-path execution and native route handoff optimizations for singleton-safe routes while preserving middleware, guards, pipes, interceptors, error handling, adapter fallback, raw-body, multipart, streaming, abort, and request-scope behavior.

- Updated dependencies [[`37ae1c5`](https://github.com/fluojs/fluo/commit/37ae1c594e0a2330cae10faddb350cd2a039643c)]:
  - @fluojs/http@1.0.0-beta.6
  - @fluojs/runtime@1.0.0-beta.8

## 1.0.0-beta.7

### Patch Changes

- [#1477](https://github.com/fluojs/fluo/pull/1477) [`1b0a68a`](https://github.com/fluojs/fluo/commit/1b0a68a1537ebd508f7dcefac92be97cbd20b84b) Thanks [@ayden94](https://github.com/ayden94)! - Optimize Node-backed request shell creation so Express, Fastify, and raw Node adapters reuse host-parsed request data where possible without changing query, body, raw body, multipart, or native route handoff behavior.

- Updated dependencies [[`1b0a68a`](https://github.com/fluojs/fluo/commit/1b0a68a1537ebd508f7dcefac92be97cbd20b84b), [`e1bce3d`](https://github.com/fluojs/fluo/commit/e1bce3d758794b5a58704f5ccda7e0bf4aed01f0), [`3baf5df`](https://github.com/fluojs/fluo/commit/3baf5dfc1e09d95f4869cd7d847b545c49609ed7), [`005d3d7`](https://github.com/fluojs/fluo/commit/005d3d78dd490ee9278bb5a736572d327ab7d3dc)]:
  - @fluojs/runtime@1.0.0-beta.7
  - @fluojs/http@1.0.0-beta.5

## 1.0.0-beta.6

### Patch Changes

- [#1465](https://github.com/fluojs/fluo/pull/1465) [`6130e63`](https://github.com/fluojs/fluo/commit/6130e6302669fa85b3416d243c4813df08b1fe47) Thanks [@ayden94](https://github.com/ayden94)! - Reduce Fastify adapter request and response hot-path overhead while preserving request headers, query, cookie, raw-body, multipart, streaming, and abort behavior.

- Updated dependencies [[`c3ef937`](https://github.com/fluojs/fluo/commit/c3ef9375d83e9c3ee0e3caf52f6b3414c5b8e5d3)]:
  - @fluojs/runtime@1.0.0-beta.6

## 1.0.0-beta.5

### Patch Changes

- [#1454](https://github.com/fluojs/fluo/pull/1454) [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27) Thanks [@ayden94](https://github.com/ayden94)! - Avoid duplicate route matching when semantically safe adapter-native routes hand a pre-matched descriptor into the shared `@fluojs/http` dispatcher.

  Keep `@All(...)`, same-shape params, normalization-sensitive paths, `OPTIONS`/CORS ownership, and versioning-sensitive routes on the generic fallback path so adapter portability contracts stay unchanged.

- [#1459](https://github.com/fluojs/fluo/pull/1459) [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946) Thanks [@ayden94](https://github.com/ayden94)! - Add a conservative fast path for successful object and array JSON responses while preserving existing formatter, streaming, redirect, binary, string, header, status, and error semantics.

- Updated dependencies [[`72462e3`](https://github.com/fluojs/fluo/commit/72462e34b4e5f41ff46ca8a98dce2f35d0ead5a0), [`48a9f97`](https://github.com/fluojs/fluo/commit/48a9f9761c093e6622922719869a29a84f7d0079), [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27), [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946), [`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f)]:
  - @fluojs/http@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.5

## 1.0.0-beta.4

### Patch Changes

- [#1426](https://github.com/fluojs/fluo/pull/1426) [`a17bd5f`](https://github.com/fluojs/fluo/commit/a17bd5f18e09960f38966f43aca0ddc043a6dc13) Thanks [@ayden94](https://github.com/ayden94)! - Preserve `FrameworkRequest.rawBody` as the exact original bytes in the Fastify adapter when `rawBody: true` is enabled for non-multipart requests.

- [#1439](https://github.com/fluojs/fluo/pull/1439) [`16420f9`](https://github.com/fluojs/fluo/commit/16420f9055ca885a459522625f8ff605f0b109b6) Thanks [@ayden94](https://github.com/ayden94)! - Improve `@fluojs/platform-fastify` request dispatch by registering Fastify-native per-route handlers when fluo route metadata can be translated safely, while keeping wildcard fallback behavior for unmatched requests.

  Preserve fluo route semantics for params, versioning, middleware/guard/interceptor/observer lifecycle, error handling, SSE, multipart, raw body, and streaming with regression coverage for native route selection.

- Updated dependencies [[`01d5e65`](https://github.com/fluojs/fluo/commit/01d5e65f053db99704d9cb30585c75b94dd38367), [`16420f9`](https://github.com/fluojs/fluo/commit/16420f9055ca885a459522625f8ff605f0b109b6), [`89f6379`](https://github.com/fluojs/fluo/commit/89f637935736c0fe9c52668a5b714c5c0e394af1), [`28ca2ef`](https://github.com/fluojs/fluo/commit/28ca2efb3d3464cc3573da5143924908146b459d)]:
  - @fluojs/http@1.0.0-beta.3
  - @fluojs/runtime@1.0.0-beta.4

## 1.0.0-beta.3

### Patch Changes

- [#1354](https://github.com/fluojs/fluo/pull/1354) [`e22c645`](https://github.com/fluojs/fluo/commit/e22c645f0ad78ec1e050db9f6b9d8e2479884959) Thanks [@ayden94](https://github.com/ayden94)! - Add Fastify coverage for the shared HTTP adapter portability harness and extend the harness to verify stream drain waiters settle when a response stream closes before a drain event.

- Updated dependencies [[`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/runtime@1.0.0-beta.2

## 1.0.0-beta.2

### Patch Changes

- [#1285](https://github.com/fluojs/fluo/pull/1285) [`185487f`](https://github.com/fluojs/fluo/commit/185487f01a8aaa0fe723b536f6bcaa2ab75cd84f) Thanks [@ayden94](https://github.com/ayden94)! - Expand CLI automation outputs for generation, inspection, migration, scaffolding, and generator metadata.

  Expose Studio-owned snapshot-to-Mermaid rendering helpers and platform snapshot types.

  Refresh the published Fastify adapter dependency metadata to fastify@^5.8.5.
