---
'@fluojs/cli': patch
'@fluojs/core': patch
'@fluojs/testing': patch
'@fluojs/vite': patch
---

Unify Vite and Vitest decorator transformation through `fluoDecoratorsPlugin`, add the explicit `@fluojs/core/metadata-preload` entrypoint, and remove the deprecated `@fluojs/testing/vitest` and `@fluojs/testing/vitest/tooling` public subpaths. Migrate Vitest configs to `fluoDecoratorsPlugin({ sourceMaps: true, transformBoundary: 'test' })` with `@fluojs/core/metadata-preload` in `setupFiles`.
