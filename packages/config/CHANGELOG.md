# @fluojs/config

## [Unreleased]

## 2.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#3695](https://github.com/fluojs/fluo/pull/3695) [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367) Thanks [@ayden94](https://github.com/ayden94)! - Make the runtime and config package boundaries truthful for edge consumers. `@fluojs/runtime` and `@fluojs/config` no longer publish package-wide Node engine requirements, while config's env-file, default `.env`, and watch features retain the executable `CONFIG_RUNTIME_UNAVAILABLE` guard on unsupported hosts.

  Migration: replace every `@fluojs/runtime/node` import with `@fluojs/platform-nodejs`, and replace every `@fluojs/runtime/internal-node` import with `@fluojs/platform-nodejs/internal`. Moved symbols retain their existing names; no compatibility shim remains on `@fluojs/runtime`. Express and Fastify now consume the Node integration seam from its platform-owned package.

### Minor Changes

- [#3464](https://github.com/fluojs/fluo/pull/3464) [`8d6c163`](https://github.com/fluojs/fluo/commit/8d6c163579c45dd49ca202c5926958c9ecb2a6d4) Thanks [@ayden94](https://github.com/ayden94)! - Add an explicit ordered multi-file env loading option to `ConfigModuleOptions` and `ConfigLoadOptions`.

  `envFilePaths` accepts one ordered list of env files merged from lowest to highest precedence into the existing env-file tier, so it stays above `defaults` and below `processEnv` and `runtimeOverrides`. Relative entries resolve against `cwd`, missing files are skipped instead of failing the load, and an empty list explicitly opts out of env-file loading including the default `<cwd>/.env` fallback. Combining `envFilePaths` with `envFile` or `envFilePath`, repeating a resolved path, or passing a blank entry fails with `INVALID_CONFIG`.

  In watch mode every distinct parent directory is watched once, any listed-file change recomputes the full list, deleting a higher-precedence file falls back to the remaining files, and validation failures keep the last valid snapshot. Automatic profile discovery stays outside the package, and existing single-file `envFile` / `envFilePath` behavior is unchanged.

### Patch Changes

- [#3444](https://github.com/fluojs/fluo/pull/3444) [`199f2f9`](https://github.com/fluojs/fluo/commit/199f2f91d68ad3db12e0db965a8f6e25a10122a0) Thanks [@ayden94](https://github.com/ayden94)! - Align built-in env-file parsing with the documented dotenv inline comment grammar. Strip an unquoted `#` comment even when no whitespace precedes it, so `VALUE=value#comment` loads as `value` instead of including the comment text, while quoted hashes such as `"value#kept"` remain part of the value across both initial loads and reloads.

- [#3014](https://github.com/fluojs/fluo/pull/3014) [`fa3a990`](https://github.com/fluojs/fluo/commit/fa3a9904f53c543ddc9fbf6f0fdf635731d07ffa) Thanks [@ayden94](https://github.com/ayden94)! - Coalesce rapid env-file watch events before reloading so change-then-revert bursts preserve the committed config snapshot and do not notify reload listeners.

- [#3687](https://github.com/fluojs/fluo/pull/3687) [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573) Thanks [@ayden94](https://github.com/ayden94)! - Drop the unused `@fluojs/config` production dependency from `@fluojs/runtime` and correct the `@fluojs/config` README guidance. Runtime source never imported the config package: configuration still enters through explicit bootstrap options and injected providers, so no import path or public export changes.

  Installing `@fluojs/runtime` no longer pulls `@fluojs/config` transitively. Applications that call `ConfigModule.forRoot(...)` or inject `ConfigService` must declare `@fluojs/config` as their own direct dependency; consumers that already list it explicitly are unaffected.

- [#3451](https://github.com/fluojs/fluo/pull/3451) [`31f9c02`](https://github.com/fluojs/fluo/commit/31f9c02d3983e321cd7a1fb752df43269681ada7) Thanks [@ayden94](https://github.com/ayden94)! - Make `ConfigReloadManager` shutdown terminal so a retained manager cannot reactivate disposed reload resources.

  After `close()` or `onModuleDestroy()`, the manager no longer creates a replacement reloader or env-file watcher: `reload()`, `subscribe()`, and `subscribeError()` throw an `InvariantError`, `onApplicationBootstrap()` becomes a no-op, and `current()` keeps returning the last committed `ConfigService` snapshot. This restores the documented watcher-cleanup guarantee, which was previously reversible through the public manager surface.

- [#3438](https://github.com/fluojs/fluo/pull/3438) [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549) Thanks [@ayden94](https://github.com/ayden94)! - Align module metadata collection types with the frozen read-only snapshots returned at runtime and keep the config
  module's provider assembly immutable.

  Code that intentionally derives a mutable collection from `getModuleMetadata()` must now copy the snapshot first,
  for example with `[...metadata.imports]`, instead of mutating the frozen metadata collection directly.

- [#3449](https://github.com/fluojs/fluo/pull/3449) [`f4e2f04`](https://github.com/fluojs/fluo/commit/f4e2f045bb68c8410c2e3435948a45e42b86d301) Thanks [@ayden94](https://github.com/ayden94)! - Make the published `@fluojs/config` declarations self-contained for consumers without Node ambient types.

  `ConfigModuleOptions.processEnv` is now typed as the package-owned `ConfigProcessEnv` (`Record<string, string | undefined>`) instead of the ambient `NodeJS.ProcessEnv` namespace, which the package never declared through `@types/node`. Strict TypeScript consumers compiling without Node types no longer fail to resolve the package root declaration. Accepted values and runtime behavior are unchanged, and `process.env` stays assignable because the structural type matches.

- Updated dependencies [[`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317)]:
  - @fluojs/core@2.0.0

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
