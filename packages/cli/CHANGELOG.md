# @fluojs/cli

## 1.0.0-beta.5

### Minor Changes

- [#1535](https://github.com/fluojs/fluo/pull/1535) [`45a84a8`](https://github.com/fluojs/fluo/commit/45a84a87fe77d2936ab075d2c7b3eafd870d3b41) Thanks [@ayden94](https://github.com/ayden94)! - Align generated project lifecycle scripts around `fluo dev`, `fluo build`, and `fluo start`, with CLI-owned runtime commands, project-local toolchain binary resolution, Workers preview-safe start behavior, and Next.js-like `NODE_ENV` defaults that preserve explicitly provided environment values.

- [#1531](https://github.com/fluojs/fluo/pull/1531) [`6cb8d78`](https://github.com/fluojs/fluo/commit/6cb8d781f3ac62f7848da71aad292d78948abf04) Thanks [@ayden94](https://github.com/ayden94)! - Add CLI roadmap command MVPs for version inspection, diagnostics, script orchestration, package workflow guidance, and composite resource generation.

- [#1539](https://github.com/fluojs/fluo/pull/1539) [`f28a8c8`](https://github.com/fluojs/fluo/commit/f28a8c8e01a2dea8906c1d0b47ed60c4966b8081) Thanks [@ayden94](https://github.com/ayden94)! - Add configurable runtime console logger modes and level filtering, and add CLI lifecycle reporter controls for quieter interactive dev output while preserving raw passthrough for CI and debugging.

### Patch Changes

- [#1538](https://github.com/fluojs/fluo/pull/1538) [`2239996`](https://github.com/fluojs/fluo/commit/2239996bcc61c5fa63427511c6927ad0e248b78c) Thanks [@ayden94](https://github.com/ayden94)! - Refresh the interactive CLI latest-version check for `fluo new` and `fluo create` before scaffolding while preserving cached update checks for normal commands.

- [#1540](https://github.com/fluojs/fluo/pull/1540) [`1f312e0`](https://github.com/fluojs/fluo/commit/1f312e02ff7123a82c63d86d022ec9d3bb8c92eb) Thanks [@ayden94](https://github.com/ayden94)! - Add a fluo-owned Node dev restart runner that dedupes unchanged file saves before restart while preserving raw runtime watcher escape hatches. Config watch reloads now also skip unchanged env file saves and change-then-revert bursts before replacing the in-process snapshot.

- Updated dependencies [[`f28a8c8`](https://github.com/fluojs/fluo/commit/f28a8c8e01a2dea8906c1d0b47ed60c4966b8081)]:
  - @fluojs/runtime@1.0.0-beta.10

## 1.0.0-beta.4

### Patch Changes

- [#1527](https://github.com/fluojs/fluo/pull/1527) [`0b0bb10`](https://github.com/fluojs/fluo/commit/0b0bb10f2efa206e6c71cd5cf88ea0f28685b5e2) Thanks [@ayden94](https://github.com/ayden94)! - Refresh `fluo new` starter dependency pins to the latest published beta versions of the generated `@fluojs/*` packages.

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
