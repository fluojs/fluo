# @fluojs/core

## [Unreleased]

## 2.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#3438](https://github.com/fluojs/fluo/pull/3438) [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549) Thanks [@ayden94](https://github.com/ayden94)! - Align module metadata collection types with the frozen read-only snapshots returned at runtime and keep the config
  module's provider assembly immutable.

  Code that intentionally derives a mutable collection from `getModuleMetadata()` must now copy the snapshot first,
  for example with `[...metadata.imports]`, instead of mutating the frozen metadata collection directly.

### Minor Changes

- [#3549](https://github.com/fluojs/fluo/pull/3549) [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea) Thanks [@ayden94](https://github.com/ayden94)! - Add `@FromFiles(fieldname?)` for binding portable multipart file arrays into request DTOs.

### Patch Changes

- [#3437](https://github.com/fluojs/fluo/pull/3437) [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604) Thanks [@ayden94](https://github.com/ayden94)! - Exclude internal transaction contract notes from the published package build.

- [#3078](https://github.com/fluojs/fluo/pull/3078) [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317) Thanks [@ayden94](https://github.com/ayden94)! - Add validated uppercase custom HTTP route authoring with `Route(method, path)` and first-class RFC `Query(path)` support while preserving exact-method precedence, versioning, DTO validation, and default response semantics.

  Widen the internal route metadata method declaration so HTTP integrations can carry custom tokens, keep custom methods on Bun fetch fallback, and let Fastify wildcard fallback receive registered custom method names without creating native fluo route handoffs.

  Expose shared network and fetch-style portability assertions for body-bearing `QUERY` and extension-method routes across supported adapters.

  Require Node.js `>=24.0.0 <27` for published Node listener paths and generated Node HTTP starters so RFC `QUERY` reaches framework dispatch. This final coordinated-release policy supersedes the earlier listener-only Node floor. Bun and Deno fetch-style adapter contracts are unchanged. Cloudflare Workers' documented fetch-style contract includes body-bearing `QUERY` and extension-method dispatch through its Worker fetch handler.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release. Regenerated Node HTTP projects use the same Node support range. Custom-method and portability additions remain part of this one upcoming release per package.

## 1.1.0

### Minor Changes

- [#2299](https://github.com/fluojs/fluo/pull/2299) [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896) Thanks [@ayden94](https://github.com/ayden94)! - Add the documented `@fluojs/core/request-pipeline` metadata integration seam and migrate validation, serialization, and OpenAPI internals to it instead of importing `@fluojs/core/internal` directly.

### Patch Changes

- [#2295](https://github.com/fluojs/fluo/pull/2295) [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7) Thanks [@ayden94](https://github.com/ayden94)! - Freeze class DI wrapper-token snapshots so caller-owned `forwardRef(...)` and `optional(...)` wrapper mutations cannot rewrite stored injection metadata.

- [#2648](https://github.com/fluojs/fluo/pull/2648) [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925) Thanks [@ayden94](https://github.com/ayden94)! - Restore the governed `Unreleased` changelog placeholder for foundation packages and preserve it when Changesets generates future package versions.

- [#2401](https://github.com/fluojs/fluo/pull/2401) [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942) Thanks [@ayden94](https://github.com/ayden94)! - Share explicit metadata stores across duplicate in-process package instances so decorators and runtime readers preserve module, controller, route, DI, and validation metadata in linked workspace benchmark runs.

## 1.0.3

### Patch Changes

- [#1988](https://github.com/fluojs/fluo/pull/1988) [`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629) Thanks [@ayden94](https://github.com/ayden94)! - Align foundation package contracts with their documented public surfaces and lifecycle diagnostics guidance.

## 1.0.2

### Patch Changes

- [#1840](https://github.com/fluojs/fluo/pull/1840) [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986) Thanks [@ayden94](https://github.com/ayden94)! - Preserve mapped DTO field metadata through documented subclassing patterns while preventing subset and partial DTO helpers from inheriting base class-level validators that depend on omitted or optional fields.

## 1.0.0

### Minor Changes

- fa0ecca: Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
- aaab8c4: Harden `@fluojs/testing/vitest` module-id and Babel config portability, make HTTP portability harness assertions less flaky, and add a public `getModuleMetadata()` reader through the core root entrypoint so testing helpers avoid private internals.

### Patch Changes

- 4fdb48c: Support Bun legacy decorator bundle output for HTTP route metadata while preserving the TC39 standard decorator metadata path.
- c5aebdf: Avoid installing the global `Symbol.metadata` polyfill as an import side effect; applications and tests should call `ensureMetadataSymbol()` at explicit bootstrap boundaries when they need the polyfill.
- 33987e4: Fix documented `@Inject(forwardRef(...))` and `@Inject(optional(...))` TypeScript compatibility by sharing wrapper-aware injection token types across core decorators and DI helpers.

## 1.0.0-beta.6

### Patch Changes

- [#1814](https://github.com/fluojs/fluo/pull/1814) [`33987e4`](https://github.com/fluojs/fluo/commit/33987e4b3168154b06693a5fbf062472e06ab157) Thanks [@ayden94](https://github.com/ayden94)! - Fix documented `@Inject(forwardRef(...))` and `@Inject(optional(...))` TypeScript compatibility by sharing wrapper-aware injection token types across core decorators and DI helpers.

## 1.0.0-beta.5

### Minor Changes

- [#1692](https://github.com/fluojs/fluo/pull/1692) [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0) Thanks [@ayden94](https://github.com/ayden94)! - Harden `@fluojs/testing/vitest` module-id and Babel config portability, make HTTP portability harness assertions less flaky, and add a public `getModuleMetadata()` reader through the core root entrypoint so testing helpers avoid private internals.

## 1.0.0-beta.4

### Patch Changes

- [#1550](https://github.com/fluojs/fluo/pull/1550) [`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3) Thanks [@ayden94](https://github.com/ayden94)! - Support Bun legacy decorator bundle output for HTTP route metadata while preserving the TC39 standard decorator metadata path.

## 1.0.0-beta.3

### Patch Changes

- [#1510](https://github.com/fluojs/fluo/pull/1510) [`c5aebdf`](https://github.com/fluojs/fluo/commit/c5aebdfe141bda72a6701516c48ace0f5caf5ee2) Thanks [@ayden94](https://github.com/ayden94)! - Avoid installing the global `Symbol.metadata` polyfill as an import side effect; applications and tests should call `ensureMetadataSymbol()` at explicit bootstrap boundaries when they need the polyfill.

## 1.0.0-beta.2

### Minor Changes

- [#1380](https://github.com/fluojs/fluo/pull/1380) [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440) Thanks [@ayden94](https://github.com/ayden94)! - Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
