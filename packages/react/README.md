# @fluojs/react

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Runtime-neutral React integration for fluo applications.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Stable SSR Mental Model](#stable-ssr-mental-model)
- [Runtime and Peer Contract](#runtime-and-peer-contract)
- [Phase Boundaries](#phase-boundaries)
- [ReactModule Registration](#reactmodule-registration)
- [Router and Path Decorators](#router-and-path-decorators)
- [Web Streams SSR](#web-streams-ssr)
- [Hydration Asset Contract](#hydration-asset-contract)
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
still participating in fluo's module graph and HTTP metadata pipeline. `ReactModule.forRoot(...)`
places React routers into ordinary module controller metadata, and `@Router(...)` plus
`@Path(...)` are React facades over `@fluojs/http` controller and `GET` route metadata, so request
DTO binding, versioning, guards, interceptors, headers, route validation, matching, and dispatch
continue to use the HTTP runtime contracts.

## Stable SSR Mental Model

The stable `0.1.0` model is HTTP-first React SSR. `@Router(...)` and `@Path(...)` are lexical
React facades over `@fluojs/http` metadata: they mark classes and methods as React page surfaces for
readability and diagnostics, then write the same controller and `GET` route metadata that the HTTP
runtime already understands. URL matching remains owned by `@fluojs/http`, not React, so React page
paths inherit the HTTP route grammar, conflict detection, versioning, DTO materialization,
validation, guards, interceptors, headers, module middleware, request scopes, and request lifecycle.

This package is therefore **not** a Next.js App Router clone, React Server Components framework,
TanStack route tree, Angular `Routes[]` table, file-route scanner, or primary React-owned
`routes: []` configuration model. Treat React routers as page-shaped HTTP handlers. Route discovery
and dispatch stay in the existing fluo module/controller pipeline, and page handlers return either
ordinary values or `createReactServerEntry(...)` when they want streamed HTML.

## Runtime and Peer Contract

The root `@fluojs/react` import is runtime-neutral. Importing it must not eagerly load Node.js
built-ins, Vite, `react-dom/server`, React Server Components packages, or Server Functions code.

`react` and `react-dom` are declared as peer dependencies so applications own the React runtime
version. The package root exposes SSR helpers but resolves `react-dom/server` lazily only when a
React server entry is rendered.

## Phase Boundaries

`@fluojs/react` uses explicit subpath boundaries so the stable root stays small and runtime-neutral:

- **root `@fluojs/react`** — stable `0.1.0` SSR MVP contracts: `ReactModule.forRoot(...)`,
  `@Router(...)`, `@Path(...)`, metadata readers, `createReactServerEntry(...)`,
  `renderReactResponse(...)`, Web Streams SSR, and explicit hydration asset options.
- **future `@fluojs/react/vite`** — build-time asset manifest discovery, stylesheet ordering, and
  Vite integration. The root package accepts explicit asset options today but does not discover or
  scan manifests.
- **future `@fluojs/react/client`** — browser navigation and client hydration helpers. The root
  package does not generate client bundles or own client-side route transitions.
- **future `@fluojs/react/experimental/rsc`** — React Server Components and Server Functions
  experiments. RSC and Server Functions are outside the stable root contract and should not be
  documented as available from `@fluojs/react`.

## ReactModule Registration

Use `ReactModule.forRoot({ controllers: [...] })` inside an ordinary fluo module import to register
React routers. The returned module is a normal fluo module definition: it may include `imports`,
`providers`, `exports`, and `middleware`, and those fields keep the same visibility and lifecycle
rules as `@Module(...)` metadata.

```tsx
import { Module, Inject } from '@fluojs/core';
import { ReactModule, Router, Path } from '@fluojs/react';

class DashboardPresenter {
  render() {
    return { page: 'dashboard' };
  }
}

@Inject(DashboardPresenter)
@Router('/dashboard')
class DashboardRouter {
  constructor(private readonly presenter: DashboardPresenter) {}

  @Path('/')
  index() {
    return this.presenter.render();
  }
}

@Module({
  imports: [
    ReactModule.forRoot({
      controllers: [DashboardRouter],
      providers: [DashboardPresenter],
    }),
  ],
})
class AppModule {}
```

`ReactModule` does not own URL matching. Routers registered through it become ordinary HTTP handler
sources, so `createHandlerMapping(...)` and `Dispatcher` still detect duplicate routes, apply
module-level middleware, create request scopes, run guards and interceptors, and resolve route
versioning.

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

## Web Streams SSR

Return `createReactServerEntry(...)` from a React page handler to stream HTML through the existing
fluo HTTP dispatcher. Guards, interceptors, module middleware, route headers, `@HttpCode(...)`, DTO
binding, request scopes, and duplicate route detection all run before `renderReactResponse(...)`
finalizes the HTML response.

```tsx
import { HttpCode, RequestDto, FromPath } from '@fluojs/http';
import { Router, Path, createReactServerEntry } from '@fluojs/react';

class DashboardRequest {
  @FromPath('id')
  id = '';
}

@Router('/dashboard')
class DashboardRouter {
  @HttpCode(206)
  @Path('/:id')
  @RequestDto(DashboardRequest)
  show(input: DashboardRequest) {
    return createReactServerEntry(<main>Dashboard {input.id}</main>, {
      headers: { 'x-react-page': 'dashboard' },
      onRecoverableError(error, context) {
        // Report through your application logger; the response status is already committed.
        void error;
        void context;
      },
    });
  }
}
```

The renderer uses `react-dom/server` `renderToReadableStream(...)` by default, preserves Suspense
streaming, writes `Content-Type: text/html; charset=utf-8`, forwards `RequestContext.request.signal`
when an adapter provides one, and throws shell render failures before response bytes are committed.
Recoverable Suspense errors are reported through `onRecoverableError` and do not rewrite an already
committed status. Call `renderReactResponse(entry, requestContext)` directly only when a custom
handler needs to finalize the response itself instead of returning the entry to the dispatcher.

## Hydration Asset Contract

`createReactServerEntry(...)` accepts explicit React DOM hydration asset options and forwards them to
the Web Streams renderer:

- `bootstrapScripts` emits classic bootstrap `<script>` tags. Duplicate entries with the same `src`
  are removed before React DOM receives the option.
- `bootstrapModules` emits module bootstrap `<script type="module">` tags with the same duplicate
  removal rule.
- `bootstrapScriptContent` emits trusted inline script content exactly as provided. fluo does not
  serialize arbitrary values into this string; only use it for trusted build-time data or content that
  your application has escaped through an approved safety contract.
- `nonce` applies the CSP nonce that React DOM attaches to emitted bootstrap scripts.
- `identifierPrefix` is forwarded to React DOM so server-rendered `useId()` output and client
  hydration share the same prefix.
- `assetMap` is a defensive snapshot of trusted build-produced logical asset names to public URLs.
  fluo passes the snapshot to custom renderers and expects applications to pass the same data to the
  server root component and client `hydrateRoot(...)` call when it affects markup.

```tsx
const assetMap = {
  'main.js': '/assets/main.123.js',
  'styles.css': '/assets/styles.123.css',
} as const;

return createReactServerEntry(<App assetMap={assetMap} />, {
  assetMap,
  bootstrapModules: [assetMap['main.js']],
  bootstrapScriptContent: 'window.__FLUO_ASSET_MAP__ = {"main.js":"/assets/main.123.js"};',
  identifierPrefix: 'fluo-',
  nonce: cspNonce,
});
```

CSS/JS ordering is caller-owned in this phase. Future Vite manifest integration should preserve
manifest stylesheet order in the app-rendered document head before hydration scripts, then preserve
the caller order of `bootstrapScripts` and `bootstrapModules` after duplicate removal. This package
does not discover Vite manifests, scan the filesystem, generate client bundles, or serialize
untrusted user data into inline scripts.

## Current Limitations

This package currently does **not** provide:

- `@fluojs/react/vite`
- `@fluojs/react/client`
- `@fluojs/react/experimental/rsc`
- React Server Components or Server Functions integration
- a Next.js App Router, TanStack route tree, Angular `Routes[]`, file-route scanner, or React-owned
  `routes: []` table
- automatic client bundle generation
- automatic Vite manifest discovery or filesystem scanning
- automatic serialization of arbitrary data into `bootstrapScriptContent`
- Node-only `react-dom/server` pipeable stream root APIs such as `renderToPipeableStream(...)`

## Public API

- `Router` — class decorator that writes HTTP controller metadata plus React router marker metadata.
- `Path` — method decorator that writes HTTP `GET` route metadata plus React render metadata.
- `getReactRouterMetadata` — reads React router marker metadata from a router class.
- `getReactPathMetadata` — reads React render metadata from a router method.
- `ReactModule` — runtime-neutral module facade whose `forRoot(...)` registers React routers through
  the existing fluo module/controller metadata path.
- `createReactServerEntry` — creates a runtime-neutral React server entry returned by page handlers
  for Web Streams SSR.
- `renderReactResponse` — renders one React server entry to a fluo HTML response with lazy
  `react-dom/server` loading.
- `ReactAssetMap`, `ReactBootstrapAsset`, and `ReactBootstrapScriptDescriptor` — type-only contracts
  for build-produced asset maps and React DOM bootstrap script/module entries.
- `ReactModuleOptions` — options accepted by `ReactModule.forRoot(...)`, including `controllers`,
  `imports`, `providers`, `exports`, and module-level `middleware`.
- `ReactServerEntry`, `ReactServerEntryOptions`, `ReactServerEntryHeaders`,
  `ReactRecoverableErrorHandler`, `ReactRecoverableErrorContext`, `ReactRenderContext`,
  `ReactReadableStream`, `ReactReadableStreamRenderer`, `ReactReadableStreamRenderOptions`, and
  `RenderReactResponseOptions` — type-only contracts for streamed React SSR and hydration assets.
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
- `packages/react/src/server-entry.ts`
- `packages/react/src/render.ts`
- `packages/react/src/module.ts`
- `packages/react/src/render.test.ts`
- `packages/react/src/dispatcher-ssr.test.ts`
- `packages/react/src/hydration-assets.test.ts`
- `packages/react/src/lifecycle-pipeline.test.ts`
- `packages/react/src/module.test.ts`
- `packages/react/src/decorators.test.ts`
- `packages/react/src/index.test.ts`
- `examples/react-stable-ssr/README.md`
- `examples/react-stable-ssr/src/app.test.ts`
