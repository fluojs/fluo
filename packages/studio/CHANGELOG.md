# @fluojs/studio

## [Unreleased]

## 1.0.8

### Patch Changes

- [#2475](https://github.com/fluojs/fluo/pull/2475) [`a96c675`](https://github.com/fluojs/fluo/commit/a96c675542ba4549f07001cfeb4ae7e2158924d2) Thanks [@ayden94](https://github.com/ayden94)! - Harden Studio live helper contracts by making filtered Mermaid rendering deterministic across serialized snapshots, selecting live route graph nodes by stable route ids, and documenting the Node.js viewer/runtime dependency boundary.

- [#2335](https://github.com/fluojs/fluo/pull/2335) [`ed5eb41`](https://github.com/fluojs/fluo/commit/ed5eb41b55601d47c9d81a8ac82535da20c0f228) Thanks [@ayden94](https://github.com/ayden94)! - Isolate static/report viewer state from stale live sidecar state and cover the packaged `@fluojs/studio/viewer` artifact resolution workflow.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925)]:
  - @fluojs/runtime@2.0.0

## 1.0.7

### Patch Changes

- [#2230](https://github.com/fluojs/fluo/pull/2230) [`a82e1be`](https://github.com/fluojs/fluo/commit/a82e1be012df5e8315ba0d0efa509d9c3bc988ac) Thanks [@ayden94](https://github.com/ayden94)! - Harden Studio live request trace validation so body-like request/response payload fields are rejected before viewer state can retain them, and extend static/report artifact coverage for snapshot-plus-timing, report, and standalone timing workflows.

- [#2164](https://github.com/fluojs/fluo/pull/2164) [`c87216f`](https://github.com/fluojs/fluo/commit/c87216f246ca840b896f5f7c1ff5efdcdd31aa26) Thanks [@ayden94](https://github.com/ayden94)! - Preserve internal component identity when static Studio snapshots are filtered so hidden internal dependencies are not reclassified as external nodes in graph rendering or connection inspection.

- Updated dependencies [[`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/runtime@1.1.8

## 1.0.6

### Patch Changes

- [#2059](https://github.com/fluojs/fluo/pull/2059) [`0892106`](https://github.com/fluojs/fluo/commit/0892106ff31f4156c8690e939adbb539058cb5e3) Thanks [@ayden94](https://github.com/ayden94)! - Expand Studio live event contract coverage, abort stale sidecar state replay during cleanup, document `isStudioLiveEvent(value)`, and align Studio docs with the shipped `fluo dev --studio` live devtool plus static artifact compatibility.

- Updated dependencies [[`6bbbf6a`](https://github.com/fluojs/fluo/commit/6bbbf6addd0f626db3bd8b0ddb442ae8f33236e1)]:
  - @fluojs/runtime@1.1.6

## 1.0.5

### Patch Changes

- [#2032](https://github.com/fluojs/fluo/pull/2032) [`439d93e`](https://github.com/fluojs/fluo/commit/439d93eb1caa850574410811bac31e8668651192) Thanks [@ayden94](https://github.com/ayden94)! - Add the runtime-connected Studio devtool path with `fluo dev --studio`, a local sidecar live event bridge, runtime snapshot/request instrumentation, and a React/FSD Studio UI while preserving static report compatibility.

- Updated dependencies [[`439d93e`](https://github.com/fluojs/fluo/commit/439d93eb1caa850574410811bac31e8668651192)]:
  - @fluojs/runtime@1.1.3

## 1.0.4

### Patch Changes

- [#2014](https://github.com/fluojs/fluo/pull/2014) [`c87ab77`](https://github.com/fluojs/fluo/commit/c87ab770f57eecbc245f38bab186a65f9d957537) Thanks [@ayden94](https://github.com/ayden94)! - Add a Studio connection explorer for inspecting selected component dependencies, dependents, external links, and related diagnostics from inspect snapshots.

- Updated dependencies [[`01db179`](https://github.com/fluojs/fluo/commit/01db1796ee7af744c2e222f0c20da1a6973e3b6b)]:
  - @fluojs/runtime@1.1.2

## 1.0.3

### Patch Changes

- [#1984](https://github.com/fluojs/fluo/pull/1984) [`8fe1869`](https://github.com/fluojs/fluo/commit/8fe1869b7c2f6ac26b50a04a50be707ac7ff93cb) Thanks [@ayden94](https://github.com/ayden94)! - Fix the packaged Studio viewer so built assets resolve from the exported HTML file path, validate `inspect --report` summaries against their snapshot and timing payloads, and keep Studio build contract tests isolated from repository `dist` artifacts.

- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629)]:
  - @fluojs/runtime@1.1.1

## 1.0.2

### Patch Changes

- [#1861](https://github.com/fluojs/fluo/pull/1861) [`92636ee`](https://github.com/fluojs/fluo/commit/92636eee23991859a04f4590871179508dee12fb) Thanks [@ayden94](https://github.com/ayden94)! - Harden Studio viewer rendering for diagnostic documentation links, Mermaid labels, and browser graph external dependency semantics.

- Updated dependencies [[`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2)]:
  - @fluojs/runtime@1.1.0

## 1.0.0

### Minor Changes

- 185487f: Expand CLI automation outputs for generation, inspection, migration, scaffolding, and generator metadata.

  Expose Studio-owned snapshot-to-Mermaid rendering helpers and platform snapshot types.

  Refresh the published Fastify adapter dependency metadata to fastify@^5.8.5.

### Patch Changes

- ec504ae: Preserve Studio report and timing artifact parsing by accepting standalone timing diagnostics while failing malformed report envelopes without summaries.
- db1723c: Preserve Studio viewer focus while users search or filter loaded snapshots, and document the packaged viewer entry separately from repo-local development commands.
- 3ccf4e1: Clarify that `@fluojs/studio/viewer` is an asset-only manifest subpath for resolving the packaged HTML viewer entrypoint.
- Updated dependencies [da003a1]
- Updated dependencies [1b0a68a]
- Updated dependencies [93fc34b]
- Updated dependencies [37ae1c5]
- Updated dependencies [48a9f97]
- Updated dependencies [53a2b8e]
- Updated dependencies [005d3d7]
- Updated dependencies [f8d05fa]
- Updated dependencies [b74832f]
- Updated dependencies [4333cee]
- Updated dependencies [f28a8c8]
- Updated dependencies [6b8e8a9]
- Updated dependencies [89f6379]
- Updated dependencies [f0dce1f]
- Updated dependencies [c509e27]
- Updated dependencies [c3ef937]
- Updated dependencies [69936b1]
- Updated dependencies [35f60fd]
- Updated dependencies [d3504c6]
  - @fluojs/runtime@1.0.0

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
