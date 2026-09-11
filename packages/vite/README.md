# @fluojs/vite

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Vite plugin and build utilities for fluo projects.

Preparing for the coordinated Node 24 release? Follow the [consumer migration guide](../../docs/getting-started/migrate-node24.md) before upgrading packages.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Runtime and Peer Contract](#runtime-and-peer-contract)
- [Supported Vite Matrix](#supported-vite-matrix)
- [Quick Start](#quick-start)
- [Decorator Transform Boundary](#decorator-transform-boundary)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install --save-dev @fluojs/vite vite @babel/core @babel/plugin-proposal-decorators @babel/preset-typescript
```

`@babel/core` `>=7.26.0`, `@babel/plugin-proposal-decorators` `>=7.28.0`, `@babel/preset-typescript` `>=7.27.0`, and `vite` `>=6.2.0` are peer dependencies because `fluoDecoratorsPlugin()` loads Babel, resolves the Babel decorator plugin and TypeScript preset, and reports missing peer dependencies from the Vite `transform` hook when Vite transforms source files.

## When to Use

- when a fluo application uses Vite to build TypeScript that contains TC39 standard decorators
- when starter projects should import the maintained decorator transform instead of copying Babel configuration inline
- when future Vite-facing fluo build utilities need a dedicated public package boundary

## Runtime and Peer Contract

`@fluojs/vite` is a Node.js package with an `engines.node` floor of `>=24.0.0 <27`. Generated non-Deno starters now declare Vite `^8.2.2`, Vitest and `@vitest/coverage-v8` `^4.1.11`, and the Babel peers listed above. The published Vite `>=6.2.0` peer range is unchanged. Generated ESM configs use `build.rolldownOptions`, with Babel transforming decorators before Rolldown/Oxc through `fluoDecoratorsPlugin()` in the explicitly configured application or test boundary; direct Oxc/esbuild decorator processing is unsupported.

The package root is safe to import before Babel is installed or resolved: importing `@fluojs/vite` and creating `fluoDecoratorsPlugin()` do not load `@babel/core`. Babel is loaded lazily only from Vite's `transform` hook for eligible application `.ts` files, and missing Babel peers are reported from that transform boundary instead of plugin creation.

## Supported Vite Matrix

The published peer range remains `vite >=6.2.0`. The package suite runs under the workspace-pinned Vite 8.2.2 Rolldown/Oxc pipeline. Its integration gate verifies the plugin runs before normal-stage transforms and preserves field-decorator binding metadata; regressing `enforce: 'pre'` makes the gate fail. Consumers selecting Vite 8 must also satisfy Vite's own Node.js engine range.

## Quick Start

```ts
import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [fluoDecoratorsPlugin()],
  build: {
    ssr: 'src/main.ts',
    target: 'node24',
  },
});
```

The plugin transforms `.ts`, `.tsx`, `.mts`, and `.cts` files with Babel using the `2023-11` decorators proposal and `@babel/preset-typescript`. It strips Vite query suffixes before deciding the file boundary, skips declarations, `node_modules`, and (in application mode) `*.test.*` and `*.spec.*`. Importing `@fluojs/vite` or creating `fluoDecoratorsPlugin()` does not load `@babel/core`; missing Babel peers are surfaced as transform-time diagnostics for the source file Vite is transforming. Every transformed module that contains decorator syntax preloads `@fluojs/core/metadata-preload` before its decorated declarations evaluate.

## Decorator Transform Boundary

`@fluojs/vite` owns the one decorator transform for application and Vitest module graphs. Generated non-Deno starters keep the boundary explicit:

1. `vite.config.ts` imports `fluoDecoratorsPlugin()` from `@fluojs/vite`.
2. The Vite plugin strips query suffixes, accepts application `.ts`, `.tsx`, `.mts`, and `.cts` files, lazily loads Babel on the first eligible transform, and runs `@babel/plugin-proposal-decorators` with `{ version: '2023-11' }` plus `@babel/preset-typescript`.
3. `vitest.config.ts` uses `fluoDecoratorsPlugin({ sourceMaps: true, transformBoundary: 'test' })`, which includes test/spec modules and their application imports while preserving declaration and `node_modules` exclusions.

The React SSR + Vite starter keeps its decorator-bearing application declarations in `src/app.ts`;
JSX rendering remains in `.tsx` modules such as `src/page.tsx`.

Set `babelConfigFile` to a file path or resolver when a test workspace needs a root Babel configuration. Re-enabling `experimentalDecorators` or relying on direct esbuild decorator handling is outside the documented fluo support contract.

## Public API

- `fluoDecoratorsPlugin(options?)` — creates the canonical application or Vitest decorator transform.

## Related Packages

- [`@fluojs/cli`](../cli/README.md): generates starter projects that import this Vite plugin.
- [`@fluojs/testing`](../testing/README.md): provides application testing helpers.

## Example Sources

- `packages/vite/src/index.ts`
- `packages/vite/src/decorators-plugin.ts`
- `packages/cli/src/new/scaffold.ts`
