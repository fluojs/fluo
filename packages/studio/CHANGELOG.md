# @fluojs/studio

## 1.0.0-beta.5

### Patch Changes

- [#1763](https://github.com/fluojs/fluo/pull/1763) [`3ccf4e1`](https://github.com/fluojs/fluo/commit/3ccf4e180a2d8817a0fd3b4439887254808b31c5) Thanks [@ayden94](https://github.com/ayden94)! - Clarify that `@fluojs/studio/viewer` is an asset-only manifest subpath for resolving the packaged HTML viewer entrypoint.

## 1.0.0-beta.4

### Patch Changes

- [#1639](https://github.com/fluojs/fluo/pull/1639) [`db1723c`](https://github.com/fluojs/fluo/commit/db1723cde769526a6ad73e19424fc78297ec745a) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Studio viewer focus while users search or filter loaded snapshots, and document the packaged viewer entry separately from repo-local development commands.

- Updated dependencies [[`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.3

### Patch Changes

- [#1347](https://github.com/fluojs/fluo/pull/1347) [`ec504ae`](https://github.com/fluojs/fluo/commit/ec504aef6cdbfbbe1dd255b067f10a7a4a4ade2e) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Studio report and timing artifact parsing by accepting standalone timing diagnostics while failing malformed report envelopes without summaries.

- Updated dependencies [[`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/runtime@1.0.0-beta.2

## 1.0.0-beta.2

### Minor Changes

- [#1285](https://github.com/fluojs/fluo/pull/1285) [`185487f`](https://github.com/fluojs/fluo/commit/185487f01a8aaa0fe723b536f6bcaa2ab75cd84f) Thanks [@ayden94](https://github.com/ayden94)! - Expand CLI automation outputs for generation, inspection, migration, scaffolding, and generator metadata.

  Expose Studio-owned snapshot-to-Mermaid rendering helpers and platform snapshot types.

  Refresh the published Fastify adapter dependency metadata to fastify@^5.8.5.
