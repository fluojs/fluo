# @fluojs/email

## [Unreleased]

## 2.0.0

### Major Changes

- [#2649](https://github.com/fluojs/fluo/pull/2649) [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4) Thanks [@ayden94](https://github.com/ayden94)! - Bump major in lockstep with `@fluojs/runtime@2.0.0`, `@fluojs/di@2.0.0`, and `@fluojs/queue@2.0.0` because `@fluojs/email` depends on those packages' public contracts. The email package itself has no breaking API changes; consumers upgrading from `@fluojs/email@1.x` should follow the migration notes for `@fluojs/runtime` (multipart file payloads are now runtime-neutral `Uint8Array`), `@fluojs/di` (introspection state is read-only), and `@fluojs/queue` (scoped queue module discovery and dead-letter drain semantics).

### Patch Changes

- [#2617](https://github.com/fluojs/fluo/pull/2617) [`5c9246c`](https://github.com/fluojs/fluo/commit/5c9246ca684137051d2ac43f92104e2a9cb9fce9) Thanks [@ayden94](https://github.com/ayden94)! - Make repeated and concurrent Email service shutdown calls share one cleanup operation so owned transports close at most once.

- [#2402](https://github.com/fluojs/fluo/pull/2402) [`90f2a82`](https://github.com/fluojs/fluo/commit/90f2a820aadf6bdb5b4da59afee22d84ea86af23) Thanks [@ayden94](https://github.com/ayden94)! - Keep root email status snapshots transport-agnostic by omitting queue worker metadata unless callers provide it explicitly, and add regression coverage for caller-owned shutdown, notification payload forwarding, and lifecycle public exports.

- [#2305](https://github.com/fluojs/fluo/pull/2305) [`df24a8f`](https://github.com/fluojs/fluo/commit/df24a8f2ef4c38bf8ff454e3ed899f181f3a89da) Thanks [@ayden94](https://github.com/ayden94)! - Normalize lazy email transport factory failures so send-triggered initialization rejects with `EmailLifecycleError` and clears rejected transport state before shutdown.

- [#2614](https://github.com/fluojs/fluo/pull/2614) [`3fb32b8`](https://github.com/fluojs/fluo/commit/3fb32b87483f95d9d40203481ce5e967e13a4149) Thanks [@ayden94](https://github.com/ayden94)! - Reject queued notifications whose channel does not match the configured email channel before calling the email transport.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`471c923`](https://github.com/fluojs/fluo/commit/471c92379dcb55946b6ae6b2522f9544a14d9a52), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`7045978`](https://github.com/fluojs/fluo/commit/7045978594af410de6e14a638205084d3a30b465), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a1dcd40`](https://github.com/fluojs/fluo/commit/a1dcd401e72c1a9b15400c0e55b578bb48a32d3b), [`1f8896a`](https://github.com/fluojs/fluo/commit/1f8896a632932d968c988f77dbcdf6629adca81f), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/queue@2.0.0
  - @fluojs/core@1.1.0
  - @fluojs/notifications@1.0.3

## 1.0.2

### Patch Changes

- [#2261](https://github.com/fluojs/fluo/pull/2261) [`50330a6`](https://github.com/fluojs/fluo/commit/50330a64491adea44655df16d3285dca9c113007) Thanks [@ayden94](https://github.com/ayden94)! - Drain in-flight transport verify and send operations before closing owned email transports during shutdown.

- Updated dependencies [[`78a7ade`](https://github.com/fluojs/fluo/commit/78a7adea4a6dc5e5996af6ca1244c789dab377af), [`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/notifications@1.0.2
  - @fluojs/runtime@1.1.8

## 1.0.1

### Patch Changes

- [#1983](https://github.com/fluojs/fluo/pull/1983) [`e0c855e`](https://github.com/fluojs/fluo/commit/e0c855eee03d8b59e19420ea1c22ee73ef66fe44) Thanks [@ayden94](https://github.com/ayden94)! - Align notification provider delivery semantics by closing owned email transports when bootstrap verification fails, documenting Slack abort/retry handling and Discord direct batch fan-out boundaries, and strengthening notification dependency diagnostics coverage.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`0c6f149`](https://github.com/fluojs/fluo/commit/0c6f1497db78d1d6c8175206df0f1cb5d1bc74f8), [`e0c855e`](https://github.com/fluojs/fluo/commit/e0c855eee03d8b59e19420ea1c22ee73ef66fe44)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/di@1.0.3
  - @fluojs/notifications@1.0.1

## 1.0.0

### Minor Changes

- 7db5223: Add lifecycle-gated email and Slack delivery failures once shutdown begins so factory-owned notification transports are not reused or recreated during teardown, and expose lifecycle error classes for callers that handle send/shutdown races.
- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- e2fb7ca: Require verified email transports to finish bootstrap readiness before delivery, allow rejected async option factories to retry, and validate Nodemailer display-name address handoff.
- 35043e1: Reject blank email recipients before transport handoff, honor aborted sends before rendering or provider delivery, and preserve lifecycle provider errors as diagnostic causes.
- 10431ae: Restore the email package's optional queue boundary by keeping queue workers behind the `@fluojs/email/queue` subpath and make queued email notification workers fail incomplete provider deliveries so retry/dead-letter handling can run.
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
- Updated dependencies [1dda8b5]
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
- Updated dependencies [995a55f]
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
  - @fluojs/queue@1.0.0
  - @fluojs/notifications@1.0.0

## 1.0.0-beta.5

### Minor Changes

- [#1761](https://github.com/fluojs/fluo/pull/1761) [`7db5223`](https://github.com/fluojs/fluo/commit/7db522316b8204f80631e2594afbe9d6f9093382) Thanks [@ayden94](https://github.com/ayden94)! - Add lifecycle-gated email and Slack delivery failures once shutdown begins so factory-owned notification transports are not reused or recreated during teardown, and expose lifecycle error classes for callers that handle send/shutdown races.

### Patch Changes

- [#1825](https://github.com/fluojs/fluo/pull/1825) [`e2fb7ca`](https://github.com/fluojs/fluo/commit/e2fb7cac6da379070f12d6f1f62d3da6f9aaad73) Thanks [@ayden94](https://github.com/ayden94)! - Require verified email transports to finish bootstrap readiness before delivery, allow rejected async option factories to retry, and validate Nodemailer display-name address handoff.

- Updated dependencies [[`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157), [`512bfd7`](https://github.com/fluojs/fluo/commit/512bfd7edabd1d906e1964c0ecf5d7041d2f0477)]:
  - @fluojs/core@1.0.0-beta.6
  - @fluojs/di@1.0.0-beta.8
  - @fluojs/notifications@1.0.0-beta.5

## 1.0.0-beta.4

### Patch Changes

- [#1646](https://github.com/fluojs/fluo/pull/1646) [`35043e1`](https://github.com/fluojs/fluo/commit/35043e1a737b7ca54c4a15f9a83321891e7168dd) Thanks [@ayden94](https://github.com/ayden94)! - Reject blank email recipients before transport handoff, honor aborted sends before rendering or provider delivery, and preserve lifecycle provider errors as diagnostic causes.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`3785a42`](https://github.com/fluojs/fluo/commit/3785a42a2206104fe3f799394446fd99ef9fb7d2), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`8fb13ad`](https://github.com/fluojs/fluo/commit/8fb13ad86cdb78d4a7a0316c68aa75d6b317b69a), [`995a55f`](https://github.com/fluojs/fluo/commit/995a55f1571eb160fded3b0f7df0a37c672e1c94), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/notifications@1.0.0-beta.4
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/queue@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.3

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- Updated dependencies [[`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299)]:
  - @fluojs/notifications@1.0.0-beta.3
  - @fluojs/queue@1.0.0-beta.4

## 1.0.0-beta.2

### Patch Changes

- [#1356](https://github.com/fluojs/fluo/pull/1356) [`10431ae`](https://github.com/fluojs/fluo/commit/10431ae95edc84d922e5f4672fc2133825377e93) Thanks [@ayden94](https://github.com/ayden94)! - Restore the email package's optional queue boundary by keeping queue workers behind the `@fluojs/email/queue` subpath and make queued email notification workers fail incomplete provider deliveries so retry/dead-letter handling can run.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/notifications@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
