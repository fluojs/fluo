# @fluojs/cli

## 1.0.0-beta.3

### Minor Changes

- [#1525](https://github.com/fluojs/fluo/pull/1525) [`922fa87`](https://github.com/fluojs/fluo/commit/922fa87998ecc4c3c4b94dffb921439171663460) Thanks [@ayden94](https://github.com/ayden94)! - Update the CLI self-update flow to reuse the package manager that owns the current global install instead of always invoking pnpm.

## 1.0.0-beta.2

### Minor Changes

- [#1285](https://github.com/fluojs/fluo/pull/1285) [`185487f`](https://github.com/fluojs/fluo/commit/185487f01a8aaa0fe723b536f6bcaa2ab75cd84f) Thanks [@ayden94](https://github.com/ayden94)! - Expand CLI automation outputs for generation, inspection, migration, scaffolding, and generator metadata.

  Expose Studio-owned snapshot-to-Mermaid rendering helpers and platform snapshot types.

  Refresh the published Fastify adapter dependency metadata to fastify@^5.8.5.

### Patch Changes

- Updated dependencies [[`185487f`](https://github.com/fluojs/fluo/commit/185487f01a8aaa0fe723b536f6bcaa2ab75cd84f)]:
  - @fluojs/studio@1.0.0-beta.2
