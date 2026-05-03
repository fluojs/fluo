# @fluojs/validation

## 1.0.0-beta.3

### Patch Changes

- [#1544](https://github.com/fluojs/fluo/pull/1544) [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5) Thanks [@ayden94](https://github.com/ayden94)! - Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.

- Updated dependencies [[`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3)]:
  - @fluojs/core@1.0.0-beta.4

## 1.0.0-beta.2

### Patch Changes

- [#1504](https://github.com/fluojs/fluo/pull/1504) [`8422e56`](https://github.com/fluojs/fluo/commit/8422e566e4d22b466542ef457d36c2e99e1a634a) Thanks [@ayden94](https://github.com/ayden94)! - Reject malformed `materialize()` root payloads before DTO constructors or field initializers run, preserving request-boundary safety for invalid inputs.

- Updated dependencies [[`c5aebdf`](https://github.com/fluojs/fluo/commit/c5aebdfe141bda72a6701516c48ace0f5caf5ee2)]:
  - @fluojs/core@1.0.0-beta.3
