# @fluojs/http

## 1.0.0-beta.9

### Patch Changes

- [#1491](https://github.com/fluojs/fluo/pull/1491) [`b82b28f`](https://github.com/fluojs/fluo/commit/b82b28fbba8cd8bae631384757737db1bae2ff7f) Thanks [@ayden94](https://github.com/ayden94)! - Reduce dispatcher route-param update overhead by using direct assignment for standard writable request objects while preserving descriptor-based fallback behavior for custom request shapes.

## 1.0.0-beta.8

### Patch Changes

- [#1485](https://github.com/fluojs/fluo/pull/1485) [`a625716`](https://github.com/fluojs/fluo/commit/a625716f023ad18b3a6d0c6beb1fe8325612048c) Thanks [@ayden94](https://github.com/ayden94)! - Allow simple `@RequestDto` routes to use the shared dispatcher fast path while preserving binding, validation, request-scope, middleware, guard, and interceptor behavior.

## 1.0.0-beta.7

### Patch Changes

- [#1483](https://github.com/fluojs/fluo/pull/1483) [`3f70169`](https://github.com/fluojs/fluo/commit/3f70169c25e9cc04db6d01e7d4b17572d9174102) Thanks [@ayden94](https://github.com/ayden94)! - Route semantically safe Express native matches through the shared dispatcher native fast path when eligible while preserving full dispatcher fallback, body materialization, error handling, and documented route fallback semantics. Synthetic dispatch requests also preserve request extension data so testing helpers can continue injecting principals into `RequestContext`.

## 1.0.0-beta.6

### Patch Changes

- [#1480](https://github.com/fluojs/fluo/pull/1480) [`37ae1c5`](https://github.com/fluojs/fluo/commit/37ae1c594e0a2330cae10faddb350cd2a039643c) Thanks [@ayden94](https://github.com/ayden94)! - Add conservative HTTP fast-path execution and native route handoff optimizations for singleton-safe routes while preserving middleware, guards, pipes, interceptors, error handling, adapter fallback, raw-body, multipart, streaming, abort, and request-scope behavior.

## 1.0.0-beta.5

### Patch Changes

- [#1478](https://github.com/fluojs/fluo/pull/1478) [`e1bce3d`](https://github.com/fluojs/fluo/commit/e1bce3d758794b5a58704f5ccda7e0bf4aed01f0) Thanks [@ayden94](https://github.com/ayden94)! - Reduce singleton-route dispatcher overhead by caching stable execution plans while preserving lazy request-scope promotion, route-matched middleware behavior, observer callbacks, and request-scoped DI isolation.

- [#1475](https://github.com/fluojs/fluo/pull/1475) [`3baf5df`](https://github.com/fluojs/fluo/commit/3baf5dfc1e09d95f4869cd7d847b545c49609ed7) Thanks [@ayden94](https://github.com/ayden94)! - Improve `@RequestDto` request-pipeline throughput by skipping unnecessary validation work for DTOs without validation rules and by reducing per-request binding overhead on the common no-converter path.

## 1.0.0-beta.4

### Patch Changes

- [#1450](https://github.com/fluojs/fluo/pull/1450) [`72462e3`](https://github.com/fluojs/fluo/commit/72462e34b4e5f41ff46ca8a98dce2f35d0ead5a0) Thanks [@ayden94](https://github.com/ayden94)! - Reduce `@RequestDto()` binding overhead by reusing compiled HTTP DTO binding plans while preserving request-scoped converter resolution and existing validation/binding error contracts.

- [#1454](https://github.com/fluojs/fluo/pull/1454) [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27) Thanks [@ayden94](https://github.com/ayden94)! - Avoid duplicate route matching when semantically safe adapter-native routes hand a pre-matched descriptor into the shared `@fluojs/http` dispatcher.

  Keep `@All(...)`, same-shape params, normalization-sensitive paths, `OPTIONS`/CORS ownership, and versioning-sensitive routes on the generic fallback path so adapter portability contracts stay unchanged.

- [#1459](https://github.com/fluojs/fluo/pull/1459) [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946) Thanks [@ayden94](https://github.com/ayden94)! - Add a conservative fast path for successful object and array JSON responses while preserving existing formatter, streaming, redirect, binary, string, header, status, and error semantics.

- [#1458](https://github.com/fluojs/fluo/pull/1458) [`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f) Thanks [@ayden94](https://github.com/ayden94)! - Skip HTTP request-scope container creation for singleton-only routes while preserving isolated request-scoped DI whenever a controller graph, middleware, guard, interceptor, observer, DTO converter, or custom binder may require it.

- Updated dependencies [[`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f)]:
  - @fluojs/di@1.0.0-beta.5

## 1.0.0-beta.3

### Minor Changes

- [#1441](https://github.com/fluojs/fluo/pull/1441) [`28ca2ef`](https://github.com/fluojs/fluo/commit/28ca2efb3d3464cc3573da5143924908146b459d) Thanks [@ayden94](https://github.com/ayden94)! - Expose `Dispatcher.describeRoutes?.()` for adapter-side route introspection and let the Bun adapter pre-register semver-safe `Bun.serve({ routes })` entries for compatible static and parameter routes. Same-shape parameter routes, `ALL` handlers, older Bun runtimes, and other unsupported shapes continue to fall back to fetch-only dispatch so fluo path, error, and request-body semantics stay unchanged.

### Patch Changes

- [#1438](https://github.com/fluojs/fluo/pull/1438) [`01d5e65`](https://github.com/fluojs/fluo/commit/01d5e65f053db99704d9cb30585c75b94dd38367) Thanks [@ayden94](https://github.com/ayden94)! - Improve `@fluojs/http` dispatcher and route-matching hot paths by short-circuiting empty middleware/guard/interceptor/observer chains and pre-indexing static routes for faster request matching.

- [#1439](https://github.com/fluojs/fluo/pull/1439) [`16420f9`](https://github.com/fluojs/fluo/commit/16420f9055ca885a459522625f8ff605f0b109b6) Thanks [@ayden94](https://github.com/ayden94)! - Improve `@fluojs/platform-fastify` request dispatch by registering Fastify-native per-route handlers when fluo route metadata can be translated safely, while keeping wildcard fallback behavior for unmatched requests.

  Preserve fluo route semantics for params, versioning, middleware/guard/interceptor/observer lifecycle, error handling, SSE, multipart, raw body, and streaming with regression coverage for native route selection.

- Updated dependencies [[`1911e11`](https://github.com/fluojs/fluo/commit/1911e110e7dbb5296238ccc0a2e167ed6f34df86)]:
  - @fluojs/di@1.0.0-beta.4

## 1.0.0-beta.2

### Patch Changes

- [#1380](https://github.com/fluojs/fluo/pull/1380) [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440) Thanks [@ayden94](https://github.com/ayden94)! - Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.

- Updated dependencies [[`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440), [`33d51e1`](https://github.com/fluojs/fluo/commit/33d51e163b2fc6d2cf43b820a91d0b95ee552e75)]:
  - @fluojs/core@1.0.0-beta.2
  - @fluojs/di@1.0.0-beta.3
