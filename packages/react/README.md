# @fluojs/react

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Runtime-neutral React integration scaffold for fluo applications.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Runtime and Peer Contract](#runtime-and-peer-contract)
- [Router and Path Decorators](#router-and-path-decorators)
- [Current Limitations](#current-limitations)
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

Use this package when React page handlers need a lexical distinction from API controllers while
still participating in fluo's HTTP metadata pipeline. `@Router(...)` and `@Path(...)` are React
facades over `@fluojs/http` controller and `GET` route metadata, so request DTO binding,
versioning, guards, interceptors, headers, and route validation continue to use the HTTP runtime
contracts.

## Runtime and Peer Contract

The root `@fluojs/react` import is runtime-neutral. Importing it must not eagerly load Node.js
built-ins, Vite, `react-dom/server`, React Server Components packages, or Server Functions code.

`react` and `react-dom` are declared as peer dependencies so applications own the React runtime
version. The package root does not import those peers for decorator metadata.

## Router and Path Decorators

`@Router(basePath)` marks a class as a React router and writes HTTP controller metadata equivalent
to `@Controller(basePath)`. It also stores React router marker metadata readable through
`getReactRouterMetadata(...)` for diagnostics and future rendering integration.

`@Path(path, options?)` marks a method as a React page route and writes HTTP `GET` route metadata
equivalent to `@Get(path)`. It also stores React render metadata readable through
`getReactPathMetadata(...)`. The optional `options` object is metadata only in this phase; it does
not change HTTP matching or dispatch.

```tsx
import { Router, Path } from '@fluojs/react';
import { FromPath, Optional, RequestDto, FromQuery } from '@fluojs/http';

class DashboardEditRequest {
  @FromPath('id')
  id = '';

  @Optional()
  @FromQuery('tab')
  tab?: string;
}

@Router('/dashboard')
class DashboardRouter {
  @Path('/:id/edit')
  @RequestDto(DashboardEditRequest)
  edit(input: DashboardEditRequest) {
    return { page: 'dashboard-edit', input };
  }
}
```

React page paths use the exact `@fluojs/http` route grammar: literal segments and full-segment
`:param` placeholders only. Wildcards, catch-all routes, optional segments, regex-like tokens,
mixed literal/parameter segments such as `user-:id`, and suffix params such as `:id.json` are not
supported.

## Current Limitations

This package currently does **not** provide:

- SSR rendering or streaming
- `@fluojs/react/vite`
- React Server Components or Server Functions integration
- ReactModule-driven route registration beyond the HTTP metadata written by the decorators

## Public API

- `Router` — class decorator that writes HTTP controller metadata plus React router marker metadata.
- `Path` — method decorator that writes HTTP `GET` route metadata plus React render metadata.
- `getReactRouterMetadata` — reads React router marker metadata from a router class.
- `getReactPathMetadata` — reads React render metadata from a router method.
- `ReactModule` — runtime-neutral module marker for future React integration work.
- `ReactScaffoldPhase` — type-only planning marker for the `0.1.0` scaffold surface.
- `ReactRouterMetadata`, `ReactPathMetadata`, `ReactPathOptions` — type-only metadata contracts for
  diagnostics and future rendering integration.

## Related Packages

- `@fluojs/core`: Provides the standard `@Module` decorator used by the scaffold.
- `@fluojs/http`: Provides the controller, route, DTO, guard, interceptor, header, and version
  metadata pipeline reused by `@Router(...)` and `@Path(...)`.
- `@fluojs/runtime`: Future React integration work is expected to compose with runtime bootstrap
  contracts without widening the root import boundary.

## Example Sources

- `packages/react/src/index.ts`
- `packages/react/src/decorators.ts`
- `packages/react/src/module.ts`
- `packages/react/src/decorators.test.ts`
- `packages/react/src/index.test.ts`
