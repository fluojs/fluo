# @fluojs/validation

## [Unreleased]

## 1.0.6

### Patch Changes

- [#2727](https://github.com/fluojs/fluo/pull/2727) [`2c09f35`](https://github.com/fluojs/fluo/commit/2c09f3541a6ffb33a26e045f531fbecbabd5dfe7) Thanks [@ayden94](https://github.com/ayden94)! - Traverse array, Set, and Map members automatically with `ValidateNested`, matching the documented collection contract without requiring `each: true`.

- [#2636](https://github.com/fluojs/fluo/pull/2636) [`94f6518`](https://github.com/fluojs/fluo/commit/94f6518bf26b6bb412759c48d043e05e153ce533) Thanks [@ayden94](https://github.com/ayden94)! - Prevent validation decorators declared on derived DTOs from mutating inherited field-level or class-level metadata on base DTOs.

- [#2299](https://github.com/fluojs/fluo/pull/2299) [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896) Thanks [@ayden94](https://github.com/ayden94)! - Add the documented `@fluojs/core/request-pipeline` metadata integration seam and migrate validation, serialization, and OpenAPI internals to it instead of importing `@fluojs/core/internal` directly.

- Updated dependencies [[`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/core@1.1.0

## 1.0.5

### Patch Changes

- [#2023](https://github.com/fluojs/fluo/pull/2023) [`fc95494`](https://github.com/fluojs/fluo/commit/fc95494fdd3972c7bade7043c8031bbc55742f12) Thanks [@ayden94](https://github.com/ayden94)! - Avoid installing `Symbol.metadata` during validation and serialization imports, export the public `TransformFunction` type from serialization, and add regression coverage for documented validation and HTTP serialization contracts.

## 1.0.4

### Patch Changes

- [#1994](https://github.com/fluojs/fluo/pull/1994) [`45b50e6`](https://github.com/fluojs/fluo/commit/45b50e649b5f3a833555523c20b11d3bb0a07f5b) Thanks [@ayden94](https://github.com/ayden94)! - Align validation and serialization edge contracts with regression coverage for IP options, dangerous keys, custom scalar validators, cyclic arrays, and mixed object graphs.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629)]:
  - @fluojs/core@1.0.3

## 1.0.3

### Patch Changes

- [#1923](https://github.com/fluojs/fluo/pull/1923) [`794ebf3`](https://github.com/fluojs/fluo/commit/794ebf3123f50165fb7a1c909c1c575dbd431a1b) Thanks [@ayden94](https://github.com/ayden94)! - Complete the public TSDoc baseline for validation decorator exports so generated API documentation includes matching parameter and return metadata.

## 1.0.1

### Patch Changes

- [#1840](https://github.com/fluojs/fluo/pull/1840) [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986) Thanks [@ayden94](https://github.com/ayden94)! - Preserve mapped DTO field metadata through documented subclassing patterns while preventing subset and partial DTO helpers from inheriting base class-level validators that depend on omitted or optional fields.

- Updated dependencies [[`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/core@1.0.1

## 1.0.0

### Patch Changes

- b15ac1b: Return deterministic validation errors for malformed validation roots and document nested DTO instance preservation during materialization.
- 1dda8b5: Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.
- 65a08db: Harden nested DTO lazy factory resolution and keep latitude/longitude validation aligned with strict no-coercion scalar validation.
- 8422e56: Reject malformed `materialize()` root payloads before DTO constructors or field initializers run, preserving request-boundary safety for invalid inputs.
- Updated dependencies [4fdb48c]
- Updated dependencies [c5aebdf]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [aaab8c4]
  - @fluojs/core@1.0.0

## 1.0.0-beta.4

### Patch Changes

- [#1619](https://github.com/fluojs/fluo/pull/1619) [`b15ac1b`](https://github.com/fluojs/fluo/commit/b15ac1bacccf53b39862ef0243182107840e9a3a) Thanks [@ayden94](https://github.com/ayden94)! - Return deterministic validation errors for malformed validation roots and document nested DTO instance preservation during materialization.

- [#1703](https://github.com/fluojs/fluo/pull/1703) [`65a08db`](https://github.com/fluojs/fluo/commit/65a08db23814e2234bf5739fecf04f710b02a996) Thanks [@ayden94](https://github.com/ayden94)! - Harden nested DTO lazy factory resolution and keep latitude/longitude validation aligned with strict no-coercion scalar validation.

- Updated dependencies [[`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0)]:
  - @fluojs/core@1.0.0-beta.5

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
