# @fluojs/config

## [Unreleased]

## 1.0.4

### Patch Changes

- [#2646](https://github.com/fluojs/fluo/pull/2646) [`344cec0`](https://github.com/fluojs/fluo/commit/344cec07b828af4d405efea3767302840edde19e) Thanks [@ayden94](https://github.com/ayden94)! - Expose the documented `runtimeOverrides` input on `ConfigModuleOptions` and preserve its registration-time snapshot.

- [#2406](https://github.com/fluojs/fluo/pull/2406) [`ec8ffb6`](https://github.com/fluojs/fluo/commit/ec8ffb605cf4b128fb2f7786a2a606b613530164) Thanks [@ayden94](https://github.com/ayden94)! - Preserve config option schema snapshots so post-registration schema mutations cannot alter bootstrap or reload validation.

- [#2648](https://github.com/fluojs/fluo/pull/2648) [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925) Thanks [@ayden94](https://github.com/ayden94)! - Restore the governed `Unreleased` changelog placeholder for foundation packages and preserve it when Changesets generates future package versions.

- Updated dependencies [[`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/core@1.1.0

## 1.0.3

### Patch Changes

- [#2079](https://github.com/fluojs/fluo/pull/2079) [`f3f6d54`](https://github.com/fluojs/fluo/commit/f3f6d54916485cf62047c164d624af7628ef3130) Thanks [@ayden94](https://github.com/ayden94)! - Defer Node-only env-file loading dependencies so importing the root config package, or using explicit in-memory `loadConfig(...)` inputs, does not eagerly resolve Node filesystem, path, crypto, cwd, dotenv, or dotenv-expand dependencies. Env-file loading keeps the documented dotenv-compatible parser and variable expansion behavior through package-local synchronous coverage, including dotenv-expand-compatible `${VAR:-fallback}` and `${VAR-fallback}` default interpolation, and empty `loadConfig({})` / `ConfigModule.forRoot()` calls continue loading the default `<cwd>/.env` file.

  Patch note: correct the published package engine/support contract to Node.js 20.16.0 or newer because env-file/default `.env`/watch execution paths require `process.getBuiltinModule(...)`; direct filesystem/path/crypto lookup failures still fall back through `node:module` when that host boundary is available. Root package imports and explicit in-memory `loadConfig(...)` inputs remain lazy and safe because they do not eagerly resolve Node filesystem, path, crypto, cwd, dotenv, or dotenv-expand dependencies.

## 1.0.2

### Patch Changes

- [#1847](https://github.com/fluojs/fluo/pull/1847) [`34c840f`](https://github.com/fluojs/fluo/commit/34c840f3a1cd15e0399aa91467201d5b8f85a988) Thanks [@ayden94](https://github.com/ayden94)! - Keep ConfigModule watch bootstrap aligned with the injected ConfigService baseline, watch parent directories for atomic env-file replacements, and expose an onReloadError hook for automatic watch reload failures.

- Updated dependencies [[`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/core@1.0.1

## 1.0.0

### Minor Changes

- d4b7d48: Replace function-based config validation with a synchronous Standard Schema `schema` option so applications can validate and normalize config through vendor-neutral schema libraries such as Zod, Valibot, and ArkType.
- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- aa80042: Reduce redundant config snapshot cloning during bootstrap and reloads, optimize multi-source deep merging, and serialize overlapping reload requests so consumers keep isolated snapshots without reload interleaving corrupting the active config state.
- 372a80d: Implement `ConfigModule.forRoot({ watch: true })` watcher activation so documented watch reloads update the injected `ConfigService` instance during application runtime.
- e430e58: Snapshot config module/reloader options at registration time and keep watch reloads active when env files are created after startup.
- 00f4d90: Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.

- 1f312e0: Add a fluo-owned Node dev restart runner that dedupes unchanged file saves before restart while preserving raw runtime watcher escape hatches. Config watch reloads now also skip unchanged env file saves and change-then-revert bursts before replacing the in-process snapshot.
- Updated dependencies [4fdb48c]
- Updated dependencies [c5aebdf]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [aaab8c4]
  - @fluojs/core@1.0.0

## 1.0.0-beta.8

### Patch Changes

- [#1627](https://github.com/fluojs/fluo/pull/1627) [`372a80d`](https://github.com/fluojs/fluo/commit/372a80d337f8b806f05693ed33ca45d6e4289115) Thanks [@ayden94](https://github.com/ayden94)! - Implement `ConfigModule.forRoot({ watch: true })` watcher activation so documented watch reloads update the injected `ConfigService` instance during application runtime.

- Updated dependencies [[`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0)]:
  - @fluojs/core@1.0.0-beta.5

## 1.0.0-beta.7

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

## 1.0.0-beta.6

### Patch Changes

- [#1540](https://github.com/fluojs/fluo/pull/1540) [`1f312e0`](https://github.com/fluojs/fluo/commit/1f312e02ff7123a82c63d86d022ec9d3bb8c92eb) Thanks [@ayden94](https://github.com/ayden94)! - Add a fluo-owned Node dev restart runner that dedupes unchanged file saves before restart while preserving raw runtime watcher escape hatches. Config watch reloads now also skip unchanged env file saves and change-then-revert bursts before replacing the in-process snapshot.

## 1.0.0-beta.5

### Patch Changes

- [#1505](https://github.com/fluojs/fluo/pull/1505) [`e430e58`](https://github.com/fluojs/fluo/commit/e430e589d2bee458bf42199acbd50cbb25ea76c9) Thanks [@ayden94](https://github.com/ayden94)! - Snapshot config module/reloader options at registration time and keep watch reloads active when env files are created after startup.

- Updated dependencies [[`c5aebdf`](https://github.com/fluojs/fluo/commit/c5aebdfe141bda72a6701516c48ace0f5caf5ee2)]:
  - @fluojs/core@1.0.0-beta.3

## 1.0.0-beta.4

### Minor Changes

- [#1489](https://github.com/fluojs/fluo/pull/1489) [`d4b7d48`](https://github.com/fluojs/fluo/commit/d4b7d48a2843ee424261bb14e871c8df69e6d877) Thanks [@ayden94](https://github.com/ayden94)! - Replace function-based config validation with a synchronous Standard Schema `schema` option so applications can validate and normalize config through vendor-neutral schema libraries such as Zod, Valibot, and ArkType.

## 1.0.0-beta.3

### Patch Changes

- [#1377](https://github.com/fluojs/fluo/pull/1377) [`aa80042`](https://github.com/fluojs/fluo/commit/aa80042038de9dbdf062c3938710041d937b4631) Thanks [@ayden94](https://github.com/ayden94)! - Reduce redundant config snapshot cloning during bootstrap and reloads, optimize multi-source deep merging, and serialize overlapping reload requests so consumers keep isolated snapshots without reload interleaving corrupting the active config state.

- Updated dependencies [[`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440)]:
  - @fluojs/core@1.0.0-beta.2

## 1.0.0-beta.2

### Patch Changes

- [#1349](https://github.com/fluojs/fluo/pull/1349) [`00f4d90`](https://github.com/fluojs/fluo/commit/00f4d9015c597a7f6dd660a5697cf8389022611a) Thanks [@ayden94](https://github.com/ayden94)! - Recover release metadata for the already-merged audit fixes that restored package behavioral contracts, documentation, and regression coverage.

  Record the serialization response ownership fix, Passport strategy settlement and cookie-auth guardrails, config reload surface alignment, and Express adapter portability parity test helpers.

  Record the notifications injection coverage update, event-bus shutdown and public-surface guardrails, Drizzle request transaction shutdown docs, Socket.IO room contract alignment, and Redis lifecycle regression coverage.
