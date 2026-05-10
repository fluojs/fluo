# @fluojs/slack

## 1.0.0-beta.4

### Patch Changes

- [#1649](https://github.com/fluojs/fluo/pull/1649) [`9c46186`](https://github.com/fluojs/fluo/commit/9c461866856fc75d24c31c1641aab0fea7d375fe) Thanks [@ayden94](https://github.com/ayden94)! - Stop retrying permanent Slack webhook HTTP failures (such as 403, 404).

  Previously, the built-in webhook transport would mistakenly retry all errors if the attempt count had not been exhausted, ignoring the intent to only retry transient (408, 429, 5xx) failures. Now, non-transient HTTP errors correctly throw `SlackTransportError` immediately, aligning with the documented behavioral contract.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`3785a42`](https://github.com/fluojs/fluo/commit/3785a42a2206104fe3f799394446fd99ef9fb7d2), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`8fb13ad`](https://github.com/fluojs/fluo/commit/8fb13ad86cdb78d4a7a0316c68aa75d6b317b69a), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/notifications@1.0.0-beta.4
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.3

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- Updated dependencies [[`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299)]:
  - @fluojs/notifications@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- [#1357](https://github.com/fluojs/fluo/pull/1357) [`da9e66b`](https://github.com/fluojs/fluo/commit/da9e66b54cbf5404b1526258d2d06e3dc9235462) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Slack transport lifecycle ownership and tutorial status snapshot contracts with focused regression coverage and aligned package/book documentation.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/notifications@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
