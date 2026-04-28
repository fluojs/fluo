# @fluojs/runtime

## 1.0.0-beta.3

### Minor Changes

- [#1386](https://github.com/fluojs/fluo/pull/1386) [`da003a1`](https://github.com/fluojs/fluo/commit/da003a1a5f7fec7b46fcf37d5a19a91e04d8b301) Thanks [@ayden94](https://github.com/ayden94)! - Defer Node and Web request body materialization to the dispatch boundary while preserving synchronous `FrameworkRequest.body` and `rawBody` values for application code.

### Patch Changes

- [#1382](https://github.com/fluojs/fluo/pull/1382) [`c509e27`](https://github.com/fluojs/fluo/commit/c509e27da630c0cd5cffbfc72381dbc1594efc1c) Thanks [@ayden94](https://github.com/ayden94)! - Reduce runtime hot-path overhead by memoizing request metadata materialization, safe direct root singleton context lookups, and independent bootstrap lifecycle provider resolution.

- Updated dependencies [[`aa80042`](https://github.com/fluojs/fluo/commit/aa80042038de9dbdf062c3938710041d937b4631), [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440), [`33d51e1`](https://github.com/fluojs/fluo/commit/33d51e163b2fc6d2cf43b820a91d0b95ee552e75)]:
  - @fluojs/config@1.0.0-beta.3
  - @fluojs/core@1.0.0-beta.2
  - @fluojs/http@1.0.0-beta.2
  - @fluojs/di@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- [#1360](https://github.com/fluojs/fluo/pull/1360) [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f) Thanks [@ayden94](https://github.com/ayden94)! - Reset runtime health readiness markers as soon as application or context shutdown begins so `/ready` leaves traffic rotation before cleanup hooks and remains unavailable even when shutdown fails.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/config@1.0.0-beta.2
