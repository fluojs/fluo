# @fluojs/platform-fastify

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
