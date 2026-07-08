# @fluojs/react

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Runtime-neutral React integration scaffold for fluo applications.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Runtime and Peer Contract](#runtime-and-peer-contract)
- [Current Scaffold Contract](#current-scaffold-contract)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

The first public release target for this package is `0.1.0`. The manifest starts at
`0.0.0` so Changesets can publish the initial `0.1.0` version through the canonical
release workflow.

When the package is published, install it with React and React DOM as peers:

```bash
npm install @fluojs/react react react-dom
```

## When to Use

Use this package only when you need a stable package boundary for upcoming fluo React SSR
integration work. Phase 1-1 is a scaffold and does not implement rendering behavior.

## Runtime and Peer Contract

The root `@fluojs/react` import is runtime-neutral. Importing it must not eagerly load Node.js
built-ins, Vite, `react-dom/server`, React Server Components packages, or Server Functions code.

`react` and `react-dom` are declared as peer dependencies so applications own the React runtime
version. The package root does not import those peers during this scaffold phase.

## Current Scaffold Contract

This package currently provides:

- a public `ReactModule` class that marks the package boundary without registering providers,
  controllers, renderers, Vite plugins, or RSC hooks
- type-only scaffold metadata for the planned `0.1.0` public surface
- reserved source files for future decorators, server-entry, and render work

This package currently does **not** provide:

- `@Router` or `@Path` behavior
- SSR rendering or streaming
- `@fluojs/react/vite`
- React Server Components or Server Functions integration

## Public API

- `ReactModule` — runtime-neutral module marker for future React integration work.
- `ReactScaffoldPhase` — type-only planning marker for the `0.1.0` scaffold surface.

## Related Packages

- `@fluojs/core`: Provides the standard `@Module` decorator used by the scaffold.
- `@fluojs/runtime`: Future React integration work is expected to compose with runtime bootstrap
  contracts without widening the root import boundary.

## Example Sources

- `packages/react/src/index.ts`
- `packages/react/src/module.ts`
- `packages/react/src/index.test.ts`
