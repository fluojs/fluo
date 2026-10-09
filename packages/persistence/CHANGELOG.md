# @fluojs/persistence

## [Unreleased]

## 0.1.0

### Minor Changes

- [#3929](https://github.com/fluojs/fluo/pull/3929) [`6320fdd`](https://github.com/fluojs/fluo/commit/6320fdd52f40a9c3d2e5dca3694e84c17a6e1dcf) Thanks [@ayden94](https://github.com/ayden94)! - Extract shared transaction contracts, Result rollback policy, hook settlement,
  and active request work into the independent portable `@fluojs/persistence`
  package. Existing core, runtime, and ORM public imports remain compatible and
  re-export the canonical constructors without wrappers. Driver observation and
  native transaction execution remain in their ORM packages.
