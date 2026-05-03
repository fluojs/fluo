# @fluojs/graphql

## 1.0.0-beta.5

### Patch Changes

- [#1503](https://github.com/fluojs/fluo/pull/1503) [`5b97a76`](https://github.com/fluojs/fluo/commit/5b97a7657889587a9e9d03245772d1d94c7d4ef9) Thanks [@ayden94](https://github.com/ayden94)! - Restore GraphQL's patched instance helper on shutdown and cancel streaming GraphQL response bodies when downstream streams close or error, preventing long-lived subscription resources from leaking.

- Updated dependencies [[`c5aebdf`](https://github.com/fluojs/fluo/commit/c5aebdfe141bda72a6701516c48ace0f5caf5ee2), [`1d43614`](https://github.com/fluojs/fluo/commit/1d4361416e56ec935d67da096ba8b72d3886f7ee), [`f086fa5`](https://github.com/fluojs/fluo/commit/f086fa58827617bda8bdef50e0b694bd5e85dfaa), [`f8d05fa`](https://github.com/fluojs/fluo/commit/f8d05fac610bd5a58c27f84e764338ee718c0a67), [`6b8e8a9`](https://github.com/fluojs/fluo/commit/6b8e8a9d2c6123d9a1ca2ec805ef4fde97d1f199), [`8422e56`](https://github.com/fluojs/fluo/commit/8422e566e4d22b466542ef457d36c2e99e1a634a)]:
  - @fluojs/core@1.0.0-beta.3
  - @fluojs/di@1.0.0-beta.6
  - @fluojs/runtime@1.0.0-beta.9
  - @fluojs/validation@1.0.0-beta.2

## 1.0.0-beta.4

### Minor Changes

- [#1451](https://github.com/fluojs/fluo/pull/1451) [`10d7b6b`](https://github.com/fluojs/fluo/commit/10d7b6bd2d87d49b8acdcfa33822db1ff17dfb8c) Thanks [@ayden94](https://github.com/ayden94)! - Narrow the public GraphQL contract to executable `GraphQLSchema` integration and reject the unsupported resolver `topics` option instead of silently ignoring it.

### Patch Changes

- Updated dependencies [[`72462e3`](https://github.com/fluojs/fluo/commit/72462e34b4e5f41ff46ca8a98dce2f35d0ead5a0), [`48a9f97`](https://github.com/fluojs/fluo/commit/48a9f9761c093e6622922719869a29a84f7d0079), [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27), [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946), [`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f)]:
  - @fluojs/http@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.5
  - @fluojs/di@1.0.0-beta.5

## 1.0.0-beta.3

### Patch Changes

- [#1380](https://github.com/fluojs/fluo/pull/1380) [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440) Thanks [@ayden94](https://github.com/ayden94)! - Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.

- Updated dependencies [[`da003a1`](https://github.com/fluojs/fluo/commit/da003a1a5f7fec7b46fcf37d5a19a91e04d8b301), [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440), [`33d51e1`](https://github.com/fluojs/fluo/commit/33d51e163b2fc6d2cf43b820a91d0b95ee552e75), [`c509e27`](https://github.com/fluojs/fluo/commit/c509e27da630c0cd5cffbfc72381dbc1594efc1c)]:
  - @fluojs/runtime@1.0.0-beta.3
  - @fluojs/core@1.0.0-beta.2
  - @fluojs/http@1.0.0-beta.2
  - @fluojs/di@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- [#1361](https://github.com/fluojs/fluo/pull/1361) [`b35576b`](https://github.com/fluojs/fluo/commit/b35576bf0cc2ec1fc9721c5ea15b718b8b9da4e3) Thanks [@ayden94](https://github.com/ayden94)! - Align resolver input and request-scoped lifecycle contracts with focused regression coverage and package documentation.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
