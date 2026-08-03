# React Concepts in fluo

<p><strong><kbd>English</kbd></strong> <a href="./react-user-concepts.ko.md"><kbd>한국어</kbd></a></p>

This guide translates familiar React, Remix/React Router, and Next.js vocabulary into the current
fluo model. It is a navigation aid, not a feature-parity claim. The stable model is HTTP-first React
SSR: `@fluojs/http` owns routes and the request lifecycle, while the application owns page
composition and uses `@fluojs/react` to stream and hydrate React documents.

## Start with ownership

The stable request path is:

1. `@fluojs/http` matches an explicit route and runs DTO binding, validation, middleware, guards,
   interceptors, versioning, and request-scope creation.
2. An `@Path(...)` handler may return an ordinary HTTP value, which bypasses React rendering and
   keeps the normal HTTP response path. For a React-rendered page, it returns one `ReactElement` or
   returns `createReactServerEntry(...)` explicitly when that route needs entry-specific options.
3. For a returned `ReactElement`, the application `ReactPageRenderer` composes the page into its
   document shell and returns a `ReactServerEntry`.
4. The existing HTTP response writer writes the ordinary value or streams the React entry and keeps
   ownership of status, headers, errors, aborts, and not-found responses.
5. Application-loaded build assets and browser code hydrate the document and may add progressive
   navigation or local interaction.

React does not introduce a second matcher or route lifecycle. URL matching, DTO binding,
validation, guards, interceptors, middleware, versioning, request scopes, and not-found ownership
remain in `@fluojs/http`.

## Concept translation

| Familiar concept | Current fluo equivalent | Boundary |
| --- | --- | --- |
| **Page** | A `GET` handler marked with `@Router(...)` and `@Path(...)`. It may return an ordinary HTTP value that bypasses React rendering, one `ReactElement` for the configured application renderer, or `createReactServerEntry(...)` explicitly. | **Shipped.** A page is still an HTTP handler, not a file or route-module convention. |
| **Route** | The effective route compiled from ordinary fluo module/controller metadata. `@Path(...)` writes the same `GET` metadata as `@fluojs/http`; `@fluojs/react/typegen` can project the compiled page catalog into path-only href builders. | **Shipped, intentionally different.** HTTP owns matching, grammar, conflicts, params, versioning, and dispatch. Typegen does not create a route tree or represent versioned routes. |
| **Layout** | The application `ReactPageRenderer` owns the document shell and shared providers. `@PageLayout(...)` adds optional class/method component-reference metadata that the same renderer composes. | **Shipped.** There is no file ancestry or framework-owned layout router. |
| **Loading UI** | Ordinary React `Suspense` in the application tree, optionally selected for a page with `@SuspenseFallback(...)`. | **Shipped with a narrow boundary.** The fallback covers descendants that suspend during SSR; it does not observe handler `await`, forms, effects, or navigation. |
| **Data read / loader** | Read data in the `@Path(...)` handler through explicit application providers after HTTP DTO binding and validation, then pass the result to the React element. | **Shipped, intentionally different.** There is no loader runtime, loader cache, or client revalidation contract. |
| **Mutation / action** | Submit a native form to an ordinary `@Post(...)` handler, bind and validate it with `@RequestDto(...)`, apply normal guards/interceptors, mutate application state, and redirect with `303 See Other` when appropriate. | **Shipped, intentionally different.** The stable surface has no compiled action, fetcher, optimistic-state, or cache-invalidation runtime. |
| **Navigation** | Use a real `<a>` or `Link` from `@fluojs/react/client`; use `router.push(...)`, `router.replace(...)`, `router.back()`, or `router.refresh()` for controls. | **Shipped, intentionally different.** Path/search changes use full-document navigation, so the destination returns through the HTTP lifecycle. Fragment-only changes remain same-document browser navigation. |
| **Pending state** | `useNavigation()` reports the client navigation lifecycle. React `Suspense` reports rendering fallback through the component tree. Applications may add local form pending UI without removing the native form action. | **Shipped with separate phases.** There is no stable submit-state helper or shared loader/action pending model. |
| **Error UI** | HTTP pipeline failures keep the existing HTTP error path. Stable React SSR diagnostics distinguish HTTP-pipeline, pre-commit shell, request-abort, and post-shell recoverable phases. Application React error boundaries remain ordinary React code. | **Shipped, intentionally different.** There is no segment `error` file or React-owned HTTP error router. |
| **Not found** | A missing explicit route is the normal `@fluojs/http` not-found response; handlers may throw the shipped HTTP not-found exception when application lookup fails. | **Shipped, intentionally different.** There is no React `notFound()` helper or catch-all requirement. |
| **Metadata / head** | Render `<title>`, `<meta>`, and `<link>` in the application document. Use existing HTTP decorators and response APIs for status and headers. | **Shipped as application-owned composition.** There is no automatic metadata function or route-segment merge contract. |
| **Hydration** | Pass explicit hydration assets through `createReactServerEntry(...)`, render the same request URL and HTTP-matched params into a `ReactClientRouterProvider` snapshot, then call React DOM `hydrateRoot(...)` in the browser entry. | **Shipped.** Server/client data transfer and safe serialization remain application responsibilities. |
| **Build assets** | The application loads its Vite manifest and gives that value to `createReactViteAssetManifest(...)` from `@fluojs/react/vite`; the application document emits returned CSS and hydration options. | **Shipped.** fluo does not discover manifests, run Vite, generate bundles, or choose static-file/CDN hosting. |

## Package boundaries

| Import | Responsibility | Status |
| --- | --- | --- |
| `@fluojs/react` | `ReactModule.forRoot(...)`, `@Router(...)`, `@Path(...)`, page rendering policies, Web Streams SSR, diagnostics, page catalog, and explicit hydration options. | Stable runtime-neutral root. It does not import browser, Vite, typegen, or RSC code. |
| `@fluojs/react/client` | SSR-safe request-scoped route snapshots and provider composition, plus real anchors, hydrated full-document navigation controls, and URL/navigation hooks. | Stable SSR-and-browser subpath. `createReactRouteSnapshot(...)` and `ReactClientRouterProvider` support SSR and hydration; browser navigation effects bind only after hydration. It has no matcher, route table, document cache, or prefetch layer. |
| `@fluojs/react/vite` | Parse an already-loaded Vite manifest into deterministic React CSS, JavaScript, asset-map, and hydration options. | Stable build-integration subpath. It does not read files or run Vite. |
| `@fluojs/react/typegen` | Generate deterministic path-only declarations and absolute href builders from a compiled React page catalog. | Stable tooling subpath. It rejects versioned routes and does not generate query, fragment, relative-route, or route-tree contracts. |
| `@fluojs/react/experimental/rsc` | Compatibility diagnostics, application-supplied RSC manifest seams, Flight responses, and signed Server Function transport mounted on explicit HTTP endpoints. | **Experimental.** It is isolated from every stable entrypoint and is not a stable RSC or action promise. |

## Minimal end-to-end path

Before the canonical starter composition, an application author had to connect seven concepts before
confidently editing the first hydrated page: load the Vite manifest, select compatible server/client
entries, create hydration assets, implement `ReactPageRenderer`, return `ReactServerEntry`, reproduce
the request route snapshot during hydration, and keep the client entry aligned with the server
document. Those explicit seams remain the advanced contract, but they are incidental to a first page.

The supported short path is now:

1. Run `fluo new my-react-app --starter react-vite-ssr`, enter the project, and run `pnpm dev`.
2. Open `/products/sku-42?preview=true` and edit `src/page.tsx`. The page component owns page UI and
   hydrated interaction only.
3. Read `src/app.tsx` when changing routes. Its explicit `@Router(...)` / `@Path(...)` handler returns
   `<ProductPage />`, so HTTP matching, DTO validation, middleware, guards, interceptors, request
   scopes, and not-found behavior still run before React rendering.
4. Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm start`, and `pnpm test:browser` for the
   production path. The browser test verifies the first response, emitted assets, hydration,
   interaction, and full-document navigation without console warnings or errors.

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
- SPA document swapping, a client document/data cache, navigation prefetch, or optimistic mutation
  policy
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
