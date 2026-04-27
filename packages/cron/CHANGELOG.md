# @fluojs/cron

## 1.0.0-beta.2

### Patch Changes

- [#1352](https://github.com/fluojs/fluo/pull/1352) [`d05ee13`](https://github.com/fluojs/fluo/commit/d05ee1326a9e76ed97104d74c2751950aeecd8fb) Thanks [@ayden94](https://github.com/ayden94)! - Preserve active distributed cron locks when bounded shutdown times out so another node cannot start the same job while the original task is still running.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/redis@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
