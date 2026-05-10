# @fluojs/email

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
