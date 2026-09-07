# @fluojs/vite

## [Unreleased]

## 2.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

### Patch Changes

- [#3694](https://github.com/fluojs/fluo/pull/3694) [`f9c605b`](https://github.com/fluojs/fluo/commit/f9c605b5be3eb6ad7563e5617829dabc615be484) Thanks [@ayden94](https://github.com/ayden94)! - Require Vitest 4.1.11 or newer within the Vitest 4 release line for the public mock helpers and `@fluojs/testing/vitest` tooling entrypoints.

  Update the Vite plugin documentation to describe the workspace Vite 8.2.2/Rolldown verification gate while preserving the published `vite >=6.2.0` peer contract.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release. Upgrade `vitest` from version 3 to `^4.1.11` in workspaces that consume `@fluojs/testing` mock or Vitest tooling surfaces.

- [#3697](https://github.com/fluojs/fluo/pull/3697) [`a39f7b8`](https://github.com/fluojs/fluo/commit/a39f7b847095c5cc05f16a866e0649a1a0191ce4) Thanks [@ayden94](https://github.com/ayden94)! - Generate new non-Deno projects with Vite ^8.2.2, Vitest ^4.1.11, and matching @vitest/coverage-v8 ^4.1.11. Generated ESM Vite configs use Rolldown options while retaining the Babel application decorator plugin and the separate Vitest testing transform. React SSR keeps decorated declarations in .ts files and JSX in .tsx files.

  Existing projects are not rewritten. When adopting the new generated toolchain, update the three dependency ranges together, rename build.rollupOptions to build.rolldownOptions, and retain fluoDecoratorsPlugin() and fluoBabelDecoratorsPlugin(); direct Oxc/esbuild decorator processing is unsupported. Remove the generated Babel ignore rule for src/\*_/_.test.ts so the testing plugin can transform decorators declared inside tests instead of leaving them to the default compiler. The Node.js >=24.0.0 <27 policy and Bun/Deno/Workers runtime metadata are unchanged.

  The @fluojs/vite patch updates its shipped README pair to distinguish the generated Vite 8/Vitest 4 baseline from its unchanged Vite >=6.2.0 peer range. It does not change the plugin API or transform behavior.

- [#3693](https://github.com/fluojs/fluo/pull/3693) [`f57309d`](https://github.com/fluojs/fluo/commit/f57309d75779ccc234191b401e70d02a2103f3e2) Thanks [@ayden94](https://github.com/ayden94)! - Back the documented Vite `>=6.2.0` peer range with an executable Vite 8.2.2/Rolldown build gate that verifies field-decorator metadata survives the pre-transform boundary.

- [#3507](https://github.com/fluojs/fluo/pull/3507) [`c6cc61b`](https://github.com/fluojs/fluo/commit/c6cc61b6d77685c221961f0b17bc383a745beb6f) Thanks [@ayden94](https://github.com/ayden94)! - Keep React SSR + Vite starter decorator declarations in `src/app.ts` so generated projects stay within the supported `@fluojs/vite` transform boundary while JSX remains in `.tsx` modules.

- [#3568](https://github.com/fluojs/fluo/pull/3568) [`4cf200c`](https://github.com/fluojs/fluo/commit/4cf200cd677d676f8fb5a2349ceb069fe840c9d9) Thanks [@ayden94](https://github.com/ayden94)! - Fix silently dropped field decorators on Vite 7+. `fluoDecoratorsPlugin()` ran in Vite's normal plugin stage, so Vite's own transpiler (oxc on Vite 7+) stripped field decorators such as `@FromBody`, `@FromQuery`, `@FromPath`, `@FromHeader`, `@FromCookie`, `@Optional`, and `@Convert` before Babel received the file. The plugin now sets `enforce: 'pre'` so Babel transforms the original TypeScript source and standard decorators keep their runtime behavior.

## 1.0.7

### Patch Changes

- [#2331](https://github.com/fluojs/fluo/pull/2331) [`1446f20`](https://github.com/fluojs/fluo/commit/1446f201163823673019adde09e2c698b82c9eea) Thanks [@ayden94](https://github.com/ayden94)! - Keep lazy Babel peer diagnostics file-specific after a failed import, document the Node.js/Vite/Babel runtime contract in the Vite package and reference docs, and add regression coverage for bare plugin creation, successful lazy-load reuse, and concurrent eligible transforms.

- [#2474](https://github.com/fluojs/fluo/pull/2474) [`c787733`](https://github.com/fluojs/fluo/commit/c7877330563efe2ea756f71204957cfc0a8657b3) Thanks [@ayden94](https://github.com/ayden94)! - Keep the lazy Babel peer boundary covered by regression tests while removing the test-only Babel importer helper from emitted declarations.

## 1.0.6

### Patch Changes

- [#2175](https://github.com/fluojs/fluo/pull/2175) [`2230091`](https://github.com/fluojs/fluo/commit/22300918e9141c20793d59b44187ec4d8bfc7486) Thanks [@ayden94](https://github.com/ayden94)! - Document the generated Vite/Vitest decorator transform boundary and add regression coverage for lazy Babel loading plus peer dependency diagnostics.

## 1.0.5

### Patch Changes

- [#2080](https://github.com/fluojs/fluo/pull/2080) [`5867a47`](https://github.com/fluojs/fluo/commit/5867a47ed8dc28128f55a143cfb88112ce93a9e7) Thanks [@ayden94](https://github.com/ayden94)! - Lazy-load Babel from the Vite transform hook so importing `@fluojs/vite` no longer fails before Vite reaches a transform, and report missing Babel peers as transform-time diagnostics.

## 1.0.4

### Patch Changes

- [#2057](https://github.com/fluojs/fluo/pull/2057) [`74eff1a`](https://github.com/fluojs/fluo/commit/74eff1a8d0b3ad92ff556de73144e53407320a84) Thanks [@ayden94](https://github.com/ayden94)! - Fix the Vite decorator plugin boundary so application files with `test` or `spec` substrings still transform, keep the public implementation out of `src/internal`, and avoid requesting Babel sourcemaps when Vite build sourcemaps are disabled.

## 1.0.3

### Patch Changes

- [#2012](https://github.com/fluojs/fluo/pull/2012) [`cc61938`](https://github.com/fluojs/fluo/commit/cc619386cefd7430a7959e70d63da7869c87138a) Thanks [@ayden94](https://github.com/ayden94)! - Lock the Vite decorator transform contract to Babel's `2023-11` decorators proposal and document the package discovery path.

## 1.0.2

### Patch Changes

- [#1843](https://github.com/fluojs/fluo/pull/1843) [`4591da9`](https://github.com/fluojs/fluo/commit/4591da979f0cc5bf16733b35ad90669b2788b73c) Thanks [@ayden94](https://github.com/ayden94)! - Preserve the documented Vite plugin `node_modules` skip boundary for Windows-style resolved module IDs that use backslash separators.

## 1.0.0

### Minor Changes

- 1b75835: Extract the generated Vite decorator transform into the new `@fluojs/vite` package so `fluo new` projects import a maintained plugin instead of copying the Babel implementation inline.
- 4c3f271: Align the Vite plugin peer dependency contract with its Babel runtime resolution and tighten transform boundaries for application TypeScript files.

  This is a consumer-visible install contract change: `@babel/core` now requires `>=7.26.0`, `vite` now requires `>=6.2.0`, and the Babel decorator plugin/TypeScript preset are explicit peers. The minor bump is intentional for this beta package because consumers below those peer floors must update their build dependencies before upgrading.

### Patch Changes

- 7f6452b: Keep package build outputs aligned with the documented Vite plugin boundary by excluding `src/**/*.spec.ts` files alongside `src/**/*.test.ts` files.

## 1.0.0-beta.3

### Minor Changes

- [#1647](https://github.com/fluojs/fluo/pull/1647) [`4c3f271`](https://github.com/fluojs/fluo/commit/4c3f271514b264098b36d1f133fb8a1a7679bfd9) Thanks [@ayden94](https://github.com/ayden94)! - Align the Vite plugin peer dependency contract with its Babel runtime resolution and tighten transform boundaries for application TypeScript files.

  This is a consumer-visible install contract change: `@babel/core` now requires `>=7.26.0`, `vite` now requires `>=6.2.0`, and the Babel decorator plugin/TypeScript preset are explicit peers. The minor bump is intentional for this beta package because consumers below those peer floors must update their build dependencies before upgrading.

### Patch Changes

- [#1697](https://github.com/fluojs/fluo/pull/1697) [`7f6452b`](https://github.com/fluojs/fluo/commit/7f6452b3619750b5571a846d1435940679ad5e2b) Thanks [@ayden94](https://github.com/ayden94)! - Keep package build outputs aligned with the documented Vite plugin boundary by excluding `src/**/*.spec.ts` files alongside `src/**/*.test.ts` files.

## 1.0.0-beta.2

### Minor Changes

- [#1563](https://github.com/fluojs/fluo/pull/1563) [`1b75835`](https://github.com/fluojs/fluo/commit/1b7583508375a8a4cd7b5cbfa69bced006e5df5d) Thanks [@ayden94](https://github.com/ayden94)! - Extract the generated Vite decorator transform into the new `@fluojs/vite` package so `fluo new` projects import a maintained plugin instead of copying the Babel implementation inline.

## 1.0.0-beta.1

Initial prerelease package for fluo-owned Vite build utilities.

- Add `fluoDecoratorsPlugin()` for generated fluo starter `vite.config.ts` files.
