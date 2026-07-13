# @fluojs/slack

## [Unreleased]

## 1.1.4

### Patch Changes

- [#2307](https://github.com/fluojs/fluo/pull/2307) [`6e3bb42`](https://github.com/fluojs/fluo/commit/6e3bb424343f5249d7261c00ad949bc3c7d55d01) Thanks [@ayden94](https://github.com/ayden94)! - Close factory-owned Slack transports when bootstrap verification fails after the transport has already been created.

- [#2611](https://github.com/fluojs/fluo/pull/2611) [`1e7988b`](https://github.com/fluojs/fluo/commit/1e7988b770e8e51ffac8b39b71cafa2722c6691a) Thanks [@ayden94](https://github.com/ayden94)! - Drain active Slack deliveries before closing factory-owned transports during application shutdown.

- [#2621](https://github.com/fluojs/fluo/pull/2621) [`f7db1be`](https://github.com/fluojs/fluo/commit/f7db1be5100da2cfcc4b2232e18048aea1e3abae) Thanks [@ayden94](https://github.com/ayden94)! - Preserve caller cancellation across tolerant Slack batches and notification-channel delivery.

- [#2624](https://github.com/fluojs/fluo/pull/2624) [`0bf4841`](https://github.com/fluojs/fluo/commit/0bf484123ac5134a2175833f1d51d2523425809f) Thanks [@ayden94](https://github.com/ayden94)! - Preserve renderer and subject text fallbacks when notification payload text is blank.

- [#2628](https://github.com/fluojs/fluo/pull/2628) [`03e0bf5`](https://github.com/fluojs/fluo/commit/03e0bf52ead6adf047f702aea7407f1b8f991caa) Thanks [@ayden94](https://github.com/ayden94)! - Consume transient webhook response bodies before retrying delivery.

- [#2309](https://github.com/fluojs/fluo/pull/2309) [`a7d9206`](https://github.com/fluojs/fluo/commit/a7d9206f4a9477ecb343159e223eb37dd466e506) Thanks [@ayden94](https://github.com/ayden94)! - Reject Slack notification dispatches that include multiple non-empty recipients even when the payload also supplies a channel, preserving the documented one-destination boundary.

- [#2384](https://github.com/fluojs/fluo/pull/2384) [`0105a6a`](https://github.com/fluojs/fluo/commit/0105a6a14564e856bf104a436bf65fdc3743e659) Thanks [@ayden94](https://github.com/ayden94)! - Resolve Slack async module options through each application container so reusing one `SlackModule.forRootAsync(...)` module definition cannot leak resolved or rejected configuration across app boundaries.

- [#2380](https://github.com/fluojs/fluo/pull/2380) [`436cace`](https://github.com/fluojs/fluo/commit/436cace4097711b9be480854da3b55881c8d2b51) Thanks [@ayden94](https://github.com/ayden94)! - Gate Slack direct and notification-backed delivery on completed module readiness so bootstrap transport creation and optional verification finish before any provider handoff.

- [#2485](https://github.com/fluojs/fluo/pull/2485) [`20214b1`](https://github.com/fluojs/fluo/commit/20214b1385073c714d0cbe8f735f894dd5e782a8) Thanks [@ayden94](https://github.com/ayden94)! - Serialize factory-owned Slack transport cleanup across bootstrap failure and shutdown, document singleton provider wiring and public error failure modes, and add lifecycle regression coverage.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a1dcd40`](https://github.com/fluojs/fluo/commit/a1dcd401e72c1a9b15400c0e55b578bb48a32d3b), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/core@1.1.0
  - @fluojs/notifications@1.0.3

## 1.1.3

### Patch Changes

- [#2049](https://github.com/fluojs/fluo/pull/2049) [`c21d4fa`](https://github.com/fluojs/fluo/commit/c21d4fa2011542818bb9ab19006a35d492021c46) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Slack abort, shutdown, and webhook retry contracts by checking already-aborted empty batches, making owned transport shutdown idempotent, and avoiding transient retry response body reads before retry decisions.

- Updated dependencies [[`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1)]:
  - @fluojs/di@1.1.0
  - @fluojs/runtime@1.1.6

## 1.1.2

### Patch Changes

- [#2025](https://github.com/fluojs/fluo/pull/2025) [`223aa65`](https://github.com/fluojs/fluo/commit/223aa65135466d7c670186e3f18a6910fcab843a) Thanks [@ayden94](https://github.com/ayden94)! - Harden messaging and realtime lifecycle contracts by documenting Slack webhook ambient fetch fallback while preserving the existing optional fetch API, preventing Socket.IO raw server recreation after shutdown starts, preserving portable Socket.IO guard request typing, and deferring Queue metadata setup until decorator execution.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b)]:
  - @fluojs/runtime@1.1.2

## 1.1.1

### Patch Changes

- [#1983](https://github.com/fluojs/fluo/pull/1983) [`e0c855e`](https://github.com/fluojs/fluo/commit/e0c855eee03d8b59e19420ea1c22ee73ef66fe44) Thanks [@ayden94](https://github.com/ayden94)! - Align notification provider delivery semantics by closing owned email transports when bootstrap verification fails, documenting Slack abort/retry handling and Discord direct batch fan-out boundaries, and strengthening notification dependency diagnostics coverage.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`e0c855e`](https://github.com/fluojs/fluo/commit/e0c855eee03d8b59e19420ea1c22ee73ef66fe44)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/notifications@1.0.1

## 1.1.0

### Minor Changes

- [#1869](https://github.com/fluojs/fluo/pull/1869) [`41b2e38`](https://github.com/fluojs/fluo/commit/41b2e3862380f8e823e542b2e2c0279b7e4e87c8) Thanks [@ayden94](https://github.com/ayden94)! - Require `fetch` when creating the built-in Slack webhook transport so delivery uses an explicit runtime boundary, and align the public API documentation with the exported option/template contracts.

### Patch Changes

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`d23049a`](https://github.com/fluojs/fluo/commit/d23049a59a49bdaea110a5f542ae18606c782db8), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/di@1.0.2
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.2

## 1.0.0

### Minor Changes

- 7db5223: Add lifecycle-gated email and Slack delivery failures once shutdown begins so factory-owned notification transports are not reused or recreated during teardown, and expose lifecycle error classes for callers that handle send/shutdown races.
- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- 9c46186: Stop retrying permanent Slack webhook HTTP failures (such as 403, 404).

  Previously, the built-in webhook transport would mistakenly retry all errors if the attempt count had not been exhausted, ignoring the intent to only retry transient (408, 429, 5xx) failures. Now, non-transient HTTP errors correctly throw `SlackTransportError` immediately, aligning with the documented behavioral contract.

- da9e66b: Preserve Slack transport lifecycle ownership and tutorial status snapshot contracts with focused regression coverage and aligned package/book documentation.
- Updated dependencies [4fdb48c]
- Updated dependencies [da003a1]
- Updated dependencies [c5aebdf]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [1d43614]
- Updated dependencies [2159d4f]
- Updated dependencies [f086fa5]
- Updated dependencies [288a0b1]
- Updated dependencies [33d51e1]
- Updated dependencies [3785a42]
- Updated dependencies [1911e11]
- Updated dependencies [1b0a68a]
- Updated dependencies [aaab8c4]
- Updated dependencies [93fc34b]
- Updated dependencies [37ae1c5]
- Updated dependencies [48a9f97]
- Updated dependencies [53a2b8e]
- Updated dependencies [005d3d7]
- Updated dependencies [f8d05fa]
- Updated dependencies [8fb13ad]
- Updated dependencies [512bfd7]
- Updated dependencies [00f4d90]
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
- Updated dependencies [dc8fff1]
- Updated dependencies [d3504c6]
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/di@1.0.0

## 1.0.0-beta.5

### Minor Changes

- [#1761](https://github.com/fluojs/fluo/pull/1761) [`7db5223`](https://github.com/fluojs/fluo/commit/7db522316b8204f80631e2594afbe9d6f9093382) Thanks [@ayden94](https://github.com/ayden94)! - Add lifecycle-gated email and Slack delivery failures once shutdown begins so factory-owned notification transports are not reused or recreated during teardown, and expose lifecycle error classes for callers that handle send/shutdown races.

### Patch Changes

- Updated dependencies [[`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157), [`512bfd7`](https://github.com/fluojs/fluo/commit/512bfd7edabd1d906e1964c0ecf5d7041d2f0477)]:
  - @fluojs/core@1.0.0-beta.6
  - @fluojs/di@1.0.0-beta.8
  - @fluojs/notifications@1.0.0-beta.5

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
