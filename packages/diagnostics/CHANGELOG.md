# @fluojs/diagnostics

## [Unreleased]

## 0.2.0

### Minor Changes

- [#3930](https://github.com/fluojs/fluo/pull/3930) [`8500d74`](https://github.com/fluojs/fluo/commit/8500d74bef6e4d9efbfd79087693d6258c7ff035) Thanks [@ayden94](https://github.com/ayden94)! - Introduce portable `@fluojs/diagnostics` as the single owner of shared platform status, graph, trace, timing and static/report/live data contracts and readers. Existing runtime, core/internal, Studio root and feature status imports remain compatible. Preserve wire version 1, legacy route normalization, validation/privacy behavior, typed status details, Node support and runtime resource/lifecycle ownership.

  Migration: existing imports and stored artifacts require no changes. New data-only consumers may install `@fluojs/diagnostics` instead of runtime or Studio implementation. Filters, Mermaid rendering and viewer APIs stay in `@fluojs/studio`; the previously removed `@fluojs/studio/contracts` subpath is not restored. See `docs/getting-started/migrate-diagnostics.md`.
