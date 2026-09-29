# React Concepts in fluo

<p><strong><kbd>English</kbd></strong> <a href="./react-user-concepts.ko.md"><kbd>한국어</kbd></a></p>

This guide translates familiar React, Remix/React Router, and Next.js vocabulary into the current
fluo model. It is a navigation aid, not a feature-parity claim. The stable model is HTTP-first React
SSR: `@fluojs/http` owns routes and the request lifecycle, while the application owns page
composition and uses `@fluojs/react` to stream and hydrate React documents.

For the additional full-stack product target, use the [HTTP-first React product contract](../contracts/react-fullstack-product.md):
it maps CRUD and long-lived jukebox user journeys to current evidence, gaps, issue owners, and
real-browser acceptance. The shipped equivalents below are not a claim that the future product
gate has passed; the closed #2489 roadmap records earlier API milestones.

## Start with ownership

The stable request path is:

1. `@fluojs/http` matches an explicit route and runs DTO binding, validation, middleware, guards,
   interceptors, versioning, and request-scope creation.
2. An `@Path(...)` handler may return an ordinary HTTP value, which bypasses React rendering and
   keeps the normal HTTP response path. For a React-rendered page, it returns one `ReactElement`,
   returns `createReactServerEntry(...)` explicitly for entry-specific options, or opts into
   a negotiated destination with `ReactNavigationPage.create(page, { module, props })`.
3. For a returned `ReactElement`, the application `ReactPageRenderer` composes the page into its
   document shell and returns a `ReactServerEntry`.
4. The existing HTTP response writer writes the ordinary value or streams the React entry and keeps
   ownership of status, headers, errors, aborts, and not-found responses.
5. Application-loaded build assets and browser code hydrate the document and may add progressive
   navigation or local interaction.

React does not introduce a second matcher or route lifecycle. URL matching, DTO binding,
validation, guards, interceptors, middleware, versioning, request scopes, and not-found ownership
remain in `@fluojs/http`.

`@Path()` and `@Path(undefined)` mean `@Path('')`: GET at the enclosing router prefix,
or `/` under `@Router()`. `@Path('/')` resolves to the same catalog path but keeps a different
raw path. Omitted options stay absent from React metadata; duplicate and invalid routes still
fail through HTTP. Layout, fallback, and metadata factories still require explicit values.

## Concept translation

| Familiar concept | Current fluo equivalent | Boundary |
| --- | --- | --- |
| **Page** | A `GET` handler marked with `@Router(...)` and `@Path(...)`. It may return an ordinary HTTP value that bypasses React rendering, one `ReactElement` for the configured application renderer, or `createReactServerEntry(...)` explicitly. | **Shipped.** A page is still an HTTP handler, not a file or route-module convention. |
| **Route** | The effective route compiled from ordinary fluo module/controller metadata. `@Path(...)` writes the same `GET` metadata as `@fluojs/http`; `@fluojs/react/typegen` can project the compiled page catalog into path-only href builders. | **Shipped, intentionally different.** HTTP owns matching, grammar, conflicts, params, versioning, and dispatch. Typegen does not create a route tree or represent versioned routes. |
| **Layout** | The application `ReactPageRenderer` owns the document shell and shared providers. `@PageLayout(...)` adds optional class/method component-reference metadata that the same renderer composes. | **Shipped.** There is no file ancestry or framework-owned layout router. |
| **Loading UI** | Ordinary React `Suspense` in the application tree, optionally selected for a page with `@SuspenseFallback(...)`. | **Shipped with a narrow boundary.** The fallback covers descendants that suspend during SSR; it does not observe handler `await`, forms, effects, or navigation. |
| **Data read / loader** | Read data in the `@Path(...)` handler through explicit application providers after HTTP DTO binding and validation, then pass the result to the React element. | **Shipped, intentionally different.** There is no loader runtime, loader cache, or client revalidation contract. |
| **Mutation / action** | Submit a native form to an ordinary `@Post(...)` handler, bind and validate it with `@RequestDto(...)`, apply normal guards/interceptors, mutate application state, and redirect with `303 See Other` when appropriate. Call `router.invalidate()` and/or change `prefetchScope` before further in-document navigation after an auth/data mutation. | **Shipped, intentionally different.** There is no compiled action, fetcher, optimistic-state, or automatic cache revalidation. |
| **Navigation** | Use a real `<a>` or `Link` from `@fluojs/react/client`; use `router.push(...)`, `router.replace(...)`, `router.back()`, or `router.refresh()` for controls. Pass build-produced importers to `ReactClientRouterProvider` to render an HTTP-approved destination in an application-owned page slot; opt into public speculation with `Link prefetch="hover"` or `"viewport"` and provider `prefetchScope`. | **Shipped, intentionally different.** Compatible pages navigate softly with server-confirmed URL/params and browser history; other destinations use document navigation. There is no client route matcher or general document/data cache. Prefetch is off by default and can reuse only explicitly granted public navigation JSON once. |
| **Pending state** | `ReactNavigationExperience` shows an opt-in polite navigation status outside the retained page slot; `useNavigation()` remains the lower-level lifecycle and React `Suspense` covers descendants. | **Shipped for navigation only.** There is no shared form submit-state helper or loader/action pending model. |
| **Error UI** | The official composition resets an approved destination render error locally; its outer boundary diagnoses a throwing error view. HTTP pipeline failures keep HTTP status/errors, and #3864 owns fresh-HTTP transport retry. | **Shipped for page rendering.** There is no segment `error` file, shell/root recovery, or React-owned HTTP error router. |
| **Not found** | A missing explicit route is the normal `@fluojs/http` not-found response; handlers may throw the shipped HTTP not-found exception when application lookup fails. | **Shipped, intentionally different.** There is no React `notFound()` helper or catch-all requirement. |
| **Metadata / head** | `@PageMetadata(...)` resolves matched-page title/meta/link for the official SSR and soft page-owned head; HTTP retains status/headers. | **Shipped opt-in page composition.** No file-segment merge, and global CSS/icon/bootstrap remain application-owned. |
| **Hydration** | The official starter transfers the HTTP-selected initial destination in escaped JSON (64 KiB limit), resolves its built importer, and hydrates the same request URL, params, props, and shared provider. Custom low-level renderers may still supply explicit assets through `createReactServerEntry(...)`. | **Shipped in the starter.** The application chooses JSON-only props and excludes secrets/DI; low-level custom documents own their composition. |
| **Build assets** | The application loads its Vite manifest and gives that value to `createReactViteAssetManifest(...)` from `@fluojs/react/vite`; the application document emits returned CSS and hydration options. | **Shipped.** fluo does not discover manifests, run Vite, generate bundles, or choose static-file/CDN hosting. |

For the current client, `router.refresh()` reloads the **document** rather than revalidating
data in place; `router.invalidate()` only clears pending navigation and public prefetch state.
Transient failed soft loads default to a full document; `failurePolicy` on the same provider
can opt into preserving the approved shell/page for network/5xx, exposing
`useNavigation().failure` and fresh `router.retry()` / explicit `router.openDocument()`.
The production Vite example exercises this opt-in; the official generated starter explicitly
selects the network/5xx and recoverable mapped import-failure preservation policy and shell recovery controls. Shell-preserving
refresh with consumer migration (#3873) remains a
separate target, not a shipped loader cache. Auth refusal is not a transient retry,
and explicit reload/logout may intentionally end the shell. See the product contract for each
journey's separate success, failure, cancellation and verification surface.

## Package boundaries

| Import | Responsibility | Status |
| --- | --- | --- |
| `@fluojs/react` | `ReactModule.forRoot(...)`, `@Router(...)`, `@Path(...)`, page rendering policies, Web Streams SSR, diagnostics, page catalog, and explicit hydration options. | Stable runtime-neutral root. It does not import browser, Vite, typegen, or RSC code. |
| `@fluojs/react/client` | SSR-safe request-scoped route snapshots and provider composition, plus real anchors, HTTP-approved soft navigation with document fallback, bounded public navigation prefetch, and URL/navigation hooks. | Stable SSR-and-browser subpath. `createReactRouteSnapshot(...)` and `ReactClientRouterProvider` support SSR and hydration; browser navigation effects bind only after hydration. It has no matcher, route table, or general document cache. |
| `@fluojs/react/vite` | Parse an already-loaded Vite manifest into deterministic React CSS, JavaScript, asset-map, and hydration options. | Stable build-integration subpath. It does not read files or run Vite. |
| `@fluojs/react/typegen` | Generate deterministic path-only declarations and absolute href builders from a compiled React page catalog. | Stable tooling subpath. It rejects versioned routes and does not generate query, fragment, relative-route, or route-tree contracts. |
| `@fluojs/react/experimental/rsc` | Compatibility diagnostics, application-supplied RSC manifest seams, Flight responses, and signed Server Function transport mounted on explicit HTTP endpoints. | **Experimental.** It is isolated from every stable entrypoint and is not a stable RSC or action promise. |

For explicit destination loading, see the [navigation payload contract](../contracts/react-navigation-payload.md)
and the [built Vite example](../../examples/react-vite-ssr/README.md). It leaves direct HTML
requests, JavaScript-disabled anchors, and HTTP redirects/errors server-owned; `Link` and existing
router methods now render approved destinations without replacing the document.
An opted-in link may reuse a server-granted identity-independent result once; ordinary navigation,
back/forward, and non-public responses require fresh HTTP approval. See the owner contract for
the credential-omitted speculative request, cache bounds, and application auth/mutation duties.

## Minimal end-to-end path

Before the canonical starter composition, an application author had to connect seven concepts before
confidently editing the first hydrated page: load the Vite manifest, select compatible server/client
entries, create hydration assets, implement `ReactPageRenderer`, return `ReactServerEntry`, reproduce
the request route snapshot during hydration, and keep the client entry aligned with the server
document. Those explicit seams remain the advanced contract, but they are incidental to a first page.

The supported short path is now:

1. Run `fluo new my-react-app --starter react-vite-ssr`, enter the project, and run `pnpm dev`.
2. Open `/products/sku-42?preview=true`, follow the `/search?q=catalog` link, and edit
   `src/page.tsx` or `src/page-search.tsx`. Each page component owns page UI and hydrated
   interaction only; the shell remains mounted and destination-local state resets at the slot.
   The official Node starter uses Fast Refresh for compatible components and CSS HMR on the app
   origin; direct SSR requests load the current page after HTTP validation. Incompatible exports
   or hook signatures may remount/reload. See the
   [development migration](../getting-started/migrate-react-dev-hmr.md) for existing apps.
3. Read `src/app.ts` when adding a route. Its explicit `@Router(...)` / `@Path(...)` handler
   validates a DTO and selects `ReactNavigationPage.create(createElement(Page, props),
   { module: './page-name.tsx', props })`. A new `src/page-name.tsx` is discovered by the
   built importer glob without changing entry files, manifest plumbing, or the router store.
   HTTP matching, DTO validation, middleware, guards, interceptors, request scopes, and
   not-found behavior still run before React rendering.
4. Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm start`, and `pnpm test:browser` for the
   production path. The browser test verifies the first response, emitted assets, hydration,
   interaction, HTTP-approved two-page navigation, and native document behavior without
   console warnings or errors.

The generated application owns the composition behind that short path. `src/entry-server.tsx` is the
replaceable `ReactPageRenderer` and `ReactServerEntry` boundary. `src/react-app.tsx` gives server and
client one `ReactClientRouterProvider`, route snapshot, document, and stylesheet composition.
`src/entry-client.tsx` hydrates the same tree. `src/main.ts` and `src/load-manifest.ts` keep Vite
manifest I/O and actionable missing/malformed build diagnostics at the Node.js boundary. Advanced
applications can edit or replace those files and continue using every explicit API described below.

The runnable [`examples/react-vite-ssr`](../../examples/react-vite-ssr/README.md) remains the complete
native-form and policy example. For SSR without generated client assets or hydration, use
[`examples/react-stable-ssr`](../../examples/react-stable-ssr/README.md).

## Experimental surfaces

`@fluojs/react/experimental/rsc` is the only current RSC and Server Function surface. It requires
the documented exact React/renderer compatibility and application-owned build/encoding inputs.
Flight responses and Server Function calls still mount on explicit ordinary fluo HTTP routes. Do not
translate this subpath into a stable Server Component, server action, router, loader, or cache
contract. See the [RSC graduation policy](../contracts/react-rsc-graduation.md) for the evidence
required before any stable subpath can exist.

## Unsupported concepts

The current package does not provide:

- file routing, a React-owned matcher, a nested route tree, or a catch-all route grammar
- a route-module loader/action runtime, fetchers, or automatic data revalidation
- arbitrary HTML document swapping, a general client document/data cache, automatic navigation
  prefetch or optimistic mutation policy
- automatic metadata merging or segment-level `loading`, `error`, and `not-found` conventions
- automatic Vite manifest discovery, bundle generation, static-file hosting, or arbitrary inline data
  serialization
- a stable RSC subpath, built-in Flight renderer, or automatic `"use server"` transform/export
  discovery

Applications may build policies above the shipped seams, but those policies are not
`@fluojs/react` contracts and must not move route or request-lifecycle ownership out of
`@fluojs/http`.

## Related documentation

- [`@fluojs/react` package contract](../../packages/react/README.md)
- [Stable SSR runnable example](../../examples/react-stable-ssr/README.md)
- [Vite SSR, hydration, navigation, and native form runnable example](../../examples/react-vite-ssr/README.md)
- [`@fluojs/http` package contract](../../packages/http/README.md)
- [React render policy decision](../architecture/react-render-policy-decorators.md)
- [React RSC graduation policy](../contracts/react-rsc-graduation.md)
