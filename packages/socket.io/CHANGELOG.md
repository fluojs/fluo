# @fluojs/socket.io

## 1.0.6

### Patch Changes

- [#2082](https://github.com/fluojs/fluo/pull/2082) [`894b20c`](https://github.com/fluojs/fluo/commit/894b20ccc1ac14d7c89262f37074ea4fb675d104) Thanks [@ayden94](https://github.com/ayden94)! - Fail fast when unsupported realtime adapters bootstrap Socket.IO without discovered gateways, while preserving the Bun binding installation path before listen.

- Updated dependencies [[`06f35cb`](https://github.com/fluojs/fluo/commit/06f35cbef3a0343a6745e658c120eb19d15d4480), [`3c89876`](https://github.com/fluojs/fluo/commit/3c89876ab785d03dbaf14c16713d5b45b9407b8d), [`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65)]:
  - @fluojs/http@1.1.1
  - @fluojs/websockets@1.0.6
  - @fluojs/runtime@1.1.7

## 1.0.5

### Patch Changes

- [#2058](https://github.com/fluojs/fluo/pull/2058) [`2cd954a`](https://github.com/fluojs/fluo/commit/2cd954a7c2841d0c18ac9d30520c4110fde6d7d2) Thanks [@ayden94](https://github.com/ayden94)! - Reject invalid explicit Socket.IO numeric configuration and make shutdown timeout cleanup deterministic by force-disconnecting managed clients before lifecycle state is cleared.

- [#2061](https://github.com/fluojs/fluo/pull/2061) [`df7197b`](https://github.com/fluojs/fluo/commit/df7197bf7f5b254029652811ce94c6a381bc0828) Thanks [@ayden94](https://github.com/ayden94)! - Defer the Bun engine dependency load until the Bun Socket.IO bootstrap path is actually selected, preventing Node server-backed applications from crashing during package import.

- [#2052](https://github.com/fluojs/fluo/pull/2052) [`f4220a5`](https://github.com/fluojs/fluo/commit/f4220a59f222630b3f7d3efb832d277b47383bf2) Thanks [@ayden94](https://github.com/ayden94)! - Tighten fetch-style websocket runtime contracts by exposing `Request`-typed upgrade guards, pre-index gateway handlers to avoid hot-path dispatch filtering, keep Socket.IO descriptor handling aligned with the shared indexed handler contract, drain Node shutdown handlers once across attachments, and add close-code regression coverage for oversized fetch-style payloads.

- Updated dependencies [[`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1), [`f4220a5`](https://github.com/fluojs/fluo/commit/f4220a59f222630b3f7d3efb832d277b47383bf2)]:
  - @fluojs/di@1.1.0
  - @fluojs/runtime@1.1.6
  - @fluojs/websockets@1.0.5

## 1.0.4

### Patch Changes

- [#2025](https://github.com/fluojs/fluo/pull/2025) [`223aa65`](https://github.com/fluojs/fluo/commit/223aa65135466d7c670186e3f18a6910fcab843a) Thanks [@ayden94](https://github.com/ayden94)! - Harden messaging and realtime lifecycle contracts by documenting Slack webhook ambient fetch fallback while preserving the existing optional fetch API, preventing Socket.IO raw server recreation after shutdown starts, preserving portable Socket.IO guard request typing, and deferring Queue metadata setup until decorator execution.

- Updated dependencies [[`b611545`](https://github.com/fluojs/fluo/commit/b6115450a8fbfcb00ace38ab5616c0c6130f71da), [`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b), [`76600fc`](https://github.com/fluojs/fluo/commit/76600fc9e435b8024760c86ebc627ba271c09776)]:
  - @fluojs/websockets@1.0.4
  - @fluojs/runtime@1.1.2

## 1.0.3

### Patch Changes

- [#1982](https://github.com/fluojs/fluo/pull/1982) [`14f9570`](https://github.com/fluojs/fluo/commit/14f95706cd45900158a9ef18ce5fe1580f9f4736) Thanks [@ayden94](https://github.com/ayden94)! - Harden WebSocket and Socket.IO protocol-adapter conformance around Bun binary payload handling and Socket.IO namespace teardown.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`14f9570`](https://github.com/fluojs/fluo/commit/14f95706cd45900158a9ef18ce5fe1580f9f4736), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/http@1.1.0
  - @fluojs/websockets@1.0.3

## 1.0.2

### Patch Changes

- [#1850](https://github.com/fluojs/fluo/pull/1850) [`1f74b2c`](https://github.com/fluojs/fluo/commit/1f74b2c84f8c3bc9c0ff021a05dc16f1e06dc550) Thanks [@ayden94](https://github.com/ayden94)! - Honor explicit namespace paths for Socket.IO room helper joins and leaves even when the same socket id is already registered in another namespace, and configure Bun raw-server bindings before listen when no gateways are discovered.

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2), [`c02342c`](https://github.com/fluojs/fluo/commit/c02342c758a1bab8a8361fa1dc9c0d956e4d8fc7), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986), [`8e18b6b`](https://github.com/fluojs/fluo/commit/8e18b6bc24da15c947ba6b0d8817c99ae851efa5)]:
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0
  - @fluojs/websockets@1.0.1
  - @fluojs/core@1.0.1

## 1.0.0

### Minor Changes

- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- 0e7f485: Fix namespace, shutdown, and payload limit behavioral contract risks:
  - Set `cleanupEmptyChildNamespaces: false` to ensure Socket.IO v4 defaults don't prematurely clean up statically defined gateway namespaces.
  - Detach the underlying HTTP server from the Socket.IO instance before calling `io.close()` during shutdown so Socket.IO cleans up clients without closing adapter-owned/shared HTTP listeners.
  - Forward `engine.maxHttpBufferSize` to the Bun engine binding so both HTTP body limits and WebSocket payload limits are correctly bounded under `@fluojs/platform-bun`.
- 00f4d90: Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

- Updated dependencies [01d5e65]
- Updated dependencies [4fdb48c]
- Updated dependencies [72462e3]
- Updated dependencies [da003a1]
- Updated dependencies [c5aebdf]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [1d43614]
- Updated dependencies [2159d4f]
- Updated dependencies [f086fa5]
- Updated dependencies [288a0b1]
- Updated dependencies [33d51e1]
- Updated dependencies [53d3fbb]
- Updated dependencies [1dda8b5]
- Updated dependencies [3f70169]
- Updated dependencies [a124d8c]
- Updated dependencies [1911e11]
- Updated dependencies [1b0a68a]
- Updated dependencies [aaab8c4]
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
- Updated dependencies [57d61c0]
- Updated dependencies [ac77310]
  - @fluojs/http@1.0.0
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/di@1.0.0
  - @fluojs/websockets@1.0.0

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
