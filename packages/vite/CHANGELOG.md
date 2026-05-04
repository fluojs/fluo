# @fluojs/vite

## 1.0.0-beta.2

### Minor Changes

- [#1563](https://github.com/fluojs/fluo/pull/1563) [`1b75835`](https://github.com/fluojs/fluo/commit/1b7583508375a8a4cd7b5cbfa69bced006e5df5d) Thanks [@ayden94](https://github.com/ayden94)! - Extract the generated Vite decorator transform into the new `@fluojs/vite` package so `fluo new` projects import a maintained plugin instead of copying the Babel implementation inline.

## 1.0.0-beta.1

Initial prerelease package for fluo-owned Vite build utilities.

- Add `fluoDecoratorsPlugin()` for generated fluo starter `vite.config.ts` files.
