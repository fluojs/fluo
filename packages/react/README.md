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
- [Vite Asset Manifest Integration](#vite-asset-manifest-integration)
- [Client Navigation Runtime](#client-navigation-runtime)
- [Experimental RSC Prototype](#experimental-rsc-prototype)
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
- **`@fluojs/react/vite`** — Vite build manifest parsing, React server/client entry selection,
  deterministic stylesheet and JavaScript ordering, manifest diagnostics, and hydration option
  creation. The root package still accepts explicit asset options without discovering or scanning
  manifests.
- **`@fluojs/react/client`** — progressive anchors, HTTP-first full-document navigation, and
  hydration-safe URL, path-param, and navigation lifecycle hooks. Browser APIs remain isolated from
  the runtime-neutral root.
- **`@fluojs/react/experimental/rsc`** — an explicitly unstable React Server Components prototype
  for exact-version compatibility diagnostics, client-reference/server-module manifest seams, and
  Flight payload responses through ordinary fluo HTTP handlers. It does not export from the stable
  root and does not include Server Functions.

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

The [HTTP catch-all route grammar decision](../../docs/architecture/http-catch-all-route-grammar.md)
defers wildcard adoption. React does not add its own syntax: page handlers should keep explicit
server routes, and any future catch-all must first become an approved `@fluojs/http` contract.

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

CSS/JS ordering remains caller-owned when applications pass hydration options manually.
`@fluojs/react/vite` preserves manifest stylesheet order for the app-rendered document head before
hydration scripts, then preserves manifest JavaScript order plus the caller order of
`bootstrapScripts` and `bootstrapModules` after duplicate removal. This package does not discover
Vite manifests from the filesystem, generate client bundles, or serialize untrusted user data into
inline scripts.

## Vite Asset Manifest Integration

Use `@fluojs/react/vite` when a Vite-built React application needs to turn a loaded Vite manifest
into the stable hydration options accepted by `createReactServerEntry(...)`.

```tsx
import { createReactViteAssetManifest } from '@fluojs/react/vite';
import { createReactServerEntry } from '@fluojs/react';

const assets = createReactViteAssetManifest({
  base: '/assets/',
  entries: {
    client: 'src/entry-client.tsx',
    server: 'src/entry-server.tsx',
  },
  manifest: viteManifest,
  nonce: cspNonce,
});

if (!assets.ok) {
  throw new Error(assets.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
}

return createReactServerEntry(<App assetMap={assets.manifest.assetMap} />, {
  ...assets.manifest.hydrationOptions,
});
```

`createReactViteAssetManifest(...)` accepts an already-loaded manifest value. It does not read the
filesystem, run Vite, create client bundles, or add a root dependency on Vite. The parsed manifest
schema is compatible with Vite's client manifest shape:

| Field | Required | Meaning |
| --- | --- | --- |
| `file` | yes | JavaScript output file for a chunk. Selected server/client entries must resolve to `.js`, `.mjs`, or `.cjs`. |
| `src` / `name` | no | Secondary lookup keys for the explicit `entries.server` and `entries.client` selectors. |
| `isEntry` / `isDynamicEntry` | no | Vite entry markers retained for diagnostics and future compatibility. |
| `imports` | no | Static imported chunk ids. Imported chunks are ordered before the client entry. |
| `css` | no | Stylesheet files emitted for a chunk. The returned `manifest.css` keeps dependency order and removes duplicates. |
| `assets` | no | Static asset files copied into the returned `assetMap`. |

The successful result contains:

- `manifest.hydrationOptions` — `assetMap`, `bootstrapModules`, `bootstrapScripts`, trusted
  `bootstrapScriptContent`, `identifierPrefix`, and `nonce` shaped for `createReactServerEntry(...)`.
- `manifest.css` — stylesheet URLs for the application-rendered document head before hydration
  scripts.
- `manifest.js.modules` and `manifest.js.scripts` — module scripts derived from the Vite client
  import graph and caller-provided classic scripts.
- `manifest.assetMap` — a defensive snapshot of manifest keys, source names, emitted files, CSS, and
  static assets mapped to public URLs.
- `manifest.serverEntry` and `manifest.clientEntry` — resolved React server/client entries.

Expected manifest failures return diagnostics instead of throwing. Stable diagnostic codes are:

- `react-vite-manifest-missing-server-entry`
- `react-vite-manifest-missing-client-entry`
- `react-vite-manifest-malformed`
- `react-vite-manifest-unsupported-output-shape`

`@fluojs/react/vite` is separate from `@fluojs/vite`. Use `@fluojs/vite` in `vite.config.ts` for the
TC39 decorator transform used by fluo applications. Use `@fluojs/react/vite` in React SSR code to
parse React build assets and feed the existing hydration contract. Neither package owns file routes,
React-only route grammar, Next.js route segment conventions, RSC bundler behavior, or URL matching.
The runnable `examples/react-vite-ssr/` application shows this boundary with generated assets,
streamed Suspense content, direct React DOM hydration, and the client navigation subpath.

## Client Navigation Runtime

Use `@fluojs/react/client` in hydrated React pages that need navigation controls and URL state without
introducing a client-owned route table. Create the initial snapshot from the active fluo HTTP request,
then pass that same snapshot to `ReactClientRouterProvider` during server rendering and hydration.
This request-scoped snapshot prevents server/client URL state drift and carries path params produced by
the existing HTTP route match; the client runtime never derives or validates route params itself.

```tsx
import {
  Link,
  ReactClientRouterProvider,
  createReactRouteSnapshot,
  useNavigation,
  usePathname,
  useRouter,
  useSearchParams,
} from '@fluojs/react/client';

function DashboardNav() {
  const navigation = useNavigation();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <nav aria-label="Dashboard">
      <Link href="/dashboard/42/edit?tab=profile">Edit</Link>
      <button type="button" onClick={() => router.push('/dashboard/42/edit?tab=profile')}>
        Open editor
      </button>
      <output>{pathname} · {searchParams.get('tab')} · {navigation.status}</output>
    </nav>
  );
}

const initialSnapshot = createReactRouteSnapshot({
  url: requestContext.request.url,
  params: requestContext.request.params,
});

const app = (
  <ReactClientRouterProvider initialSnapshot={initialSnapshot}>
    <DashboardNav />
  </ReactClientRouterProvider>
);
```

The navigation contract is deliberately HTTP-first:

- `Link` always renders a real `<a href>` so pre-hydration clicks, disabled JavaScript, modified
  clicks, downloads, explicit targets, and cross-origin destinations keep native browser behavior.
  After hydration, an unmodified primary click to a same-origin HTTP(S) URL delegates to
  `router.push(...)`.
- `router.push(href)` uses `window.location.assign(...)`; `router.replace(href)` uses
  `window.location.replace(...)`. A same-origin destination that changes the pathname or search
  (query string) performs full-document navigation, so fluo HTTP route matching, `@RequestDto`
  binding and validation, guards, interceptors, redirects, not-found responses, non-HTML responses,
  and server failures remain authoritative.
- A fragment-only destination that keeps the current pathname and search is a same-document
  exception. The browser does not issue a new HTTP request; it emits `hashchange`, and a matching
  event completes the requested `push` or `replace` lifecycle while updating the route snapshot URL
  and hash. Because no server request occurs, fluo HTTP route matching, `@RequestDto` binding and
  validation, guards, and interceptors do not run for that fragment change.
- If the normalized destination is an identical URL to the current route snapshot, the router does
  not call `window.location.assign(...)` or `window.location.replace(...)`. It exposes `skipped`
  with the requested navigation type and destination instead.
- `router.back()` delegates to `window.history.back()`. `router.refresh()` uses
  `window.location.reload()` as the documented revalidation mechanism. It does not imply an RSC,
  loader, or client-data cache.
- `usePathname()`, `useSearchParams()`, `useParams()`, and `useRouterState()` read the provider's
  immutable route snapshot. `popstate` and `hashchange` update URL-derived fields. If a history event
  changes the pathname without a new server document, stale path params are cleared rather than
  guessed from a client route grammar.
- `useNavigation()` exposes `idle`, `navigating`, `refreshing`, `complete`, `error`, and `skipped`.
  Full-document path/search transitions normally leave the current document while `navigating` or
  `refreshing`, and the destination document starts from a new server-owned `idle` snapshot.
  Fragment-only transitions complete in the current document after the matching `hashchange`.
- Router methods reject cross-origin or non-HTTP(S) destinations with
  `ReactClientNavigationError`. Use a normal anchor for those destinations.

This phase intentionally omits `prefetch`: without an owned client data or render cache, prefetching
would promise behavior the package cannot yet revalidate or consume consistently.

Client navigation does not require a catch-all route. `Link` remains a real anchor, so hydration
gaps and disabled JavaScript fall back to ordinary full-document browser navigation. The server then
matches an explicit `@Path(...)`/HTTP route or returns its normal not-found response. An intentional
deployment-level document rewrite may be configured separately, but it does not create a React route
grammar or change server DTO validation.

## Experimental RSC Prototype

> **Experimental contract:** `@fluojs/react/experimental/rsc` can change before an explicit
> graduation issue makes any RSC API stable. Do not import these APIs from the root package or treat
> them as semver-stable React framework internals.

The prototype supports **exactly** `react@19.2.6`, `react-dom@19.2.6`, and a matching Flight renderer
version. Version ranges and canary versions are not supported. If an application selects
`react-server-dom-webpack`, pin it to the same exact version; this package does not install, import,
or wrap that renderer. The stable root peer range remains broader for applications that do not use
the experimental RSC subpath.

Call `inspectReactRscEnvironment(...)` before enabling an RSC endpoint. It reports stable diagnostics
when any React version differs, the runtime does not provide Web `ReadableStream`, or the
application-owned build adapter does not provide both the client-reference manifest and explicit
server-to-client module map.

```ts
import {
  REACT_RSC_SUPPORTED_VERSION,
  inspectReactRscEnvironment,
} from '@fluojs/react/experimental/rsc';

const support = inspectReactRscEnvironment({
  reactVersion: '19.2.6',
  reactDomVersion: '19.2.6',
  flightRendererVersion: REACT_RSC_SUPPORTED_VERSION,
  runtime: { name: 'node', webStreams: typeof ReadableStream !== 'undefined' },
  build: {
    name: 'application-rsc-build',
    clientReferenceManifest: true,
    serverClientModuleMap: true,
  },
});
```

`createReactRscManifest(...)` defines the initial bundler-neutral module graph seam. Client-reference
keys resolve to `{ id, chunks, name, async? }` metadata. Each server module id maps export names back
to those client-reference keys. The helper returns a defensive snapshot, rejects unknown mapping
targets with diagnostics, and never scans files or generates bundles. Translating this seam into a
specific React Flight renderer manifest remains the application build adapter's responsibility.

```ts
import { createReactRscManifest } from '@fluojs/react/experimental/rsc';

const manifest = createReactRscManifest({
  clientReferences: {
    Counter: {
      id: 'client:counter',
      chunks: ['assets/counter.js'],
      name: 'Counter',
    },
  },
  serverClientModuleMap: {
    'server:dashboard': {
      Counter: 'Counter',
    },
  },
});
```

The application also owns Flight encoding. Return `createReactFlightResponse(...)` from an ordinary
fluo HTTP controller or React `@Path(...)` handler after the selected renderer has produced encoded
text, bytes, or a Web `ReadableStream<Uint8Array>`. The existing dispatcher still owns route
metadata, middleware, guards, interceptors, request scopes, errors, and adapter response writing;
the helper adds the fixed `text/x-component; charset=utf-8` content type and does not create a
parallel router.

```ts
import { Controller, Get } from '@fluojs/http';
import { createReactFlightResponse } from '@fluojs/react/experimental/rsc';

@Controller('/rsc')
class RscController {
  @Get('/dashboard')
  dashboard() {
    const payload = applicationFlightRenderer.render({ page: 'dashboard' });
    return createReactFlightResponse(payload);
  }
}
```

This phase does not provide a Flight encoder/decoder, a Webpack or Vite RSC plugin, automatic module
graph discovery, client bundle generation, Server Functions, file routes, route segments, or a
React-owned URL matcher.

## Current Limitations

This package currently does **not** provide:

- a stable RSC root or `@fluojs/react/rsc` subpath; RSC is available only from the explicitly unstable
  `@fluojs/react/experimental/rsc` prototype
- Server Functions integration or a built-in Flight renderer/build plugin
- SPA document swapping, a client data/loader cache, and navigation prefetching
- a Next.js App Router, TanStack route tree, Angular `Routes[]`, file-route scanner, or React-owned
  `routes: []` table
- automatic client bundle generation
- filesystem scanning or automatic manifest file discovery; pass an already-loaded manifest value to
  `@fluojs/react/vite`
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
- `@fluojs/react/vite` subpath — `createReactViteAssetManifest(...)` plus
  `ReactViteBuildManifest`, `ReactViteBuildManifestChunk`, `ReactViteManifestOptions`,
  `ReactViteManifestDiagnostic`, `ReactViteAssetManifest`, `ReactViteHydrationOptions`,
  `ReactViteJavaScriptAssets`, `ReactViteBootstrapData`, and `ReactViteResolvedEntry` for parsing
  Vite manifests into the stable hydration asset contract without importing Vite from the root.
- `@fluojs/react/client` subpath — `Link`, `ReactClientRouterProvider`,
  `createReactRouteSnapshot(...)`, `useRouter()`, `usePathname()`, `useParams()`,
  `useSearchParams()`, `useNavigation()`, and `useRouterState()` for progressive HTTP-first browser
  navigation without widening the root package or adding a client route grammar.
- `@fluojs/react/experimental/rsc` subpath — `inspectReactRscEnvironment(...)`,
  `createReactRscManifest(...)`, `createReactFlightResponse(...)`, exact-version and Flight content
  type constants, diagnostics, client-reference/server-module mapping types, and Flight response
  types without any root re-export.

## Related Packages

- `@fluojs/core`: Provides the standard `@Module` decorator used by the scaffold.
- `@fluojs/http`: Provides the controller, route, DTO, guard, interceptor, header, and version
  metadata pipeline reused by `@Router(...)` and `@Path(...)`.
- `@fluojs/runtime`: Future React integration work is expected to compose with runtime bootstrap
  contracts without widening the root import boundary.
- `@fluojs/vite`: Owns Vite's TC39 decorator transform boundary. It does not parse React hydration
  manifests; use `@fluojs/react/vite` for React server/client asset mapping.
- Application-selected Flight renderer: Encodes RSC payloads and consumes renderer-specific build
  manifests. The experimental subpath models the compatibility, manifest, and HTTP response seams
  without importing a renderer package.

## Example Sources

- `packages/react/src/index.ts`
- `packages/react/src/vite.ts`
- `packages/react/src/client.ts`
- `packages/react/src/client.test.ts`
- `packages/react/src/experimental/rsc.ts`
- `packages/react/src/experimental/rsc.test.ts`
- `packages/react/src/experimental/rsc-diagnostics.test.ts`
- `packages/react/src/experimental/rsc-flight.test.ts`
- `packages/react/src/experimental/rsc-manifest.test.ts`
- `packages/react/src/vite/create-asset-manifest.ts`
- `packages/react/src/decorators.ts`
- `packages/react/src/server-entry.ts`
- `packages/react/src/render.ts`
- `packages/react/src/module.ts`
- `packages/react/src/render.test.ts`
- `packages/react/src/dispatcher-ssr.test.ts`
- `packages/react/src/hydration-assets.test.ts`
- `packages/react/src/vite.test.ts`
- `packages/react/src/lifecycle-pipeline.test.ts`
- `packages/react/src/module.test.ts`
- `packages/react/src/decorators.test.ts`
- `packages/react/src/index.test.ts`
- `examples/react-stable-ssr/README.md`
- `examples/react-stable-ssr/src/app.test.ts`
- `examples/react-vite-ssr/README.md`
- `examples/react-vite-ssr/src/app.test.ts`
- `examples/react-vite-ssr/src/hydration.test.ts`
- `examples/react-vite-ssr/tests/production-hydration.spec.ts`
