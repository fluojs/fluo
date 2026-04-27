# @fluojs/runtime

## 1.0.0-beta.2

### Patch Changes

- [#1360](https://github.com/fluojs/fluo/pull/1360) [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f) Thanks [@ayden94](https://github.com/ayden94)! - Reset runtime health readiness markers as soon as application or context shutdown begins so `/ready` leaves traffic rotation before cleanup hooks and remains unavailable even when shutdown fails.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/config@1.0.0-beta.2
