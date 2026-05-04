# @fluojs/vite

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Vite plugin and build utilities for fluo projects.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install --save-dev @fluojs/vite vite @babel/core @babel/plugin-proposal-decorators @babel/preset-typescript
```

`@babel/core` and `vite` are peer dependencies. The decorator plugin and TypeScript preset must also be available in the consuming project because `fluoDecoratorsPlugin()` resolves them when Vite transforms source files.

## When to Use

- when a fluo application uses Vite to build TypeScript that contains TC39 standard decorators
- when starter projects should import the maintained decorator transform instead of copying Babel configuration inline
- when future Vite-facing fluo build utilities need a dedicated public package boundary

## Quick Start

```ts
import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [fluoDecoratorsPlugin()],
  build: {
    ssr: 'src/main.ts',
    target: 'node20',
  },
});
```

The plugin transforms `.ts` application files with Babel using the `2023-11` decorators proposal and `@babel/preset-typescript`. It skips files whose path includes `.test.` so generated Vitest test files continue to use the dedicated `@fluojs/testing/vitest` transform path.

## Public API

- `fluoDecoratorsPlugin()` — creates the Vite plugin used by generated fluo starter projects.

## Related Packages

- [`@fluojs/cli`](../cli/README.md): generates starter projects that import this Vite plugin.
- [`@fluojs/testing`](../testing/README.md): provides the Vitest-specific decorator transform entrypoint.

## Example Sources

- `packages/vite/src/index.ts`
- `packages/cli/src/new/scaffold.ts`
