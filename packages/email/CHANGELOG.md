# @fluojs/email

## 1.0.0-beta.2

### Patch Changes

- [#1356](https://github.com/fluojs/fluo/pull/1356) [`10431ae`](https://github.com/fluojs/fluo/commit/10431ae95edc84d922e5f4672fc2133825377e93) Thanks [@ayden94](https://github.com/ayden94)! - Restore the email package's optional queue boundary by keeping queue workers behind the `@fluojs/email/queue` subpath and make queued email notification workers fail incomplete provider deliveries so retry/dead-letter handling can run.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/notifications@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
