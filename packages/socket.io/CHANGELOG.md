# @fluojs/socket.io

## 1.0.0-beta.4

### Patch Changes

- [#1641](https://github.com/fluojs/fluo/pull/1641) [`0e7f485`](https://github.com/fluojs/fluo/commit/0e7f485e4bf4651d48edd0e6079517dc051a6524) Thanks [@ayden94](https://github.com/ayden94)! - Fix namespace, shutdown, and payload limit behavioral contract risks:
  - Set `cleanupEmptyChildNamespaces: false` to ensure Socket.IO v4 defaults don't prematurely clean up statically defined gateway namespaces.
  - Detach the underlying HTTP server from the Socket.IO instance before calling `io.close()` during shutdown so Socket.IO cleans up clients without closing adapter-owned/shared HTTP listeners.
  - Forward `engine.maxHttpBufferSize` to the Bun engine binding so both HTTP body limits and WebSocket payload limits are correctly bounded under `@fluojs/platform-bun`.
- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f), [`57d61c0`](https://github.com/fluojs/fluo/commit/57d61c0ade9112be48455c48f8ed86d11e46c726), [`ac77310`](https://github.com/fluojs/fluo/commit/ac7731044ea42347eafe5d2cc7a5c88af5dcda9d)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12
  - @fluojs/websockets@1.0.0-beta.6

## 1.0.0-beta.3

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

## 1.0.0-beta.2

### Patch Changes

- [#1349](https://github.com/fluojs/fluo/pull/1349) [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a) Thanks [@ayden94](https://github.com/ayden94)! - Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
