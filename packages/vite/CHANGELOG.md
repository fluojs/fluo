# @fluojs/vite

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
