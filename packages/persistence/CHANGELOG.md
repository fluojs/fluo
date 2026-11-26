# @fluojs/persistence

## [Unreleased]

## 0.1.1

### Patch Changes

- [#4221](https://github.com/fluojs/fluo/pull/4221) [`46f9b46`](https://github.com/fluojs/fluo/commit/46f9b46bf9780e956d36666bad2750f4f68d050f) Thanks [@ayden94](https://github.com/ayden94)! - Preserve request cancellation forwarding and reason identity when an earlier caller signal listener stops event propagation. Keep cleanup idempotent and local controller cancellation independent from the caller.

- [#4213](https://github.com/fluojs/fluo/pull/4213) [`bae15c5`](https://github.com/fluojs/fluo/commit/bae15c50cfb9f8ccaf2eaceebb7e87a80b399031) Thanks [@ayden94](https://github.com/ayden94)! - Snapshot the input array and settlement records in AfterCommitError so results and errors retain their creation-time FIFO outcomes when callers mutate the original input. Preserve rejection reason identity without cloning or freezing reason objects.

- [#4202](https://github.com/fluojs/fluo/pull/4202) [`fb64bc6`](https://github.com/fluojs/fluo/commit/fb64bc642a21b31dd80040971f1d0f3be03742ef) Thanks [@ayden94](https://github.com/ayden94)! - Document the existing Mongoose cleanup error identity split in both language READMEs: without registered hooks or a `requireAfterCommit` opt-in, a manual-session `endSession()` failure after a confirmed commit still propagates with its original identity, while hook registration or `requireAfterCommit: true` reports it as the already-committed `AfterCommitCleanupError` with `committed === true` and `cause === cleanupFailure`, and overlapping Result rollback failures stay preserved in `AggregateError.errors` with the earlier failure as `cause`. Documentation clarification of existing behavior only; no runtime change.

- [#4308](https://github.com/fluojs/fluo/pull/4308) [`5396767`](https://github.com/fluojs/fluo/commit/5396767931116b2b0ec75eda77f6e39aab9a5c14) Thanks [@ayden94](https://github.com/ayden94)! - Call application-provided `shouldRollback` predicates without a receiver in both root and nested transactions, passing the original callback result to each predicate.

## 0.1.0

### Minor Changes

- [#3929](https://github.com/fluojs/fluo/pull/3929) [`6320fdd`](https://github.com/fluojs/fluo/commit/6320fdd52f40a9c3d2e5dca3694e84c17a6e1dcf) Thanks [@ayden94](https://github.com/ayden94)! - Extract shared transaction contracts, Result rollback policy, hook settlement,
  and active request work into the independent portable `@fluojs/persistence`
  package. Existing core, runtime, and ORM public imports remain compatible and
  re-export the canonical constructors without wrappers. Driver observation and
  native transaction execution remain in their ORM packages.
