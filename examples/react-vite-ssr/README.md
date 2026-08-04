# react-vite-ssr example

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Minimal Vite-backed `@fluojs/react` application for the hydration and client-navigation phases. It connects
HTTP-owned page routes, DTO-bound parameters, streamed React SSR, Vite manifest assets, and one
hydrated browser runtime with a progressively enhanced native mutation form, without introducing a
second routing model.

## what this example demonstrates

- `@Router('/products')` and `@Path('/:sku')` page routes discovered by the fluo HTTP module graph.
- Typed path and search input through `@RequestDto(...)`, `@FromPath('sku')`, and
  `@FromQuery('preview')`.
- A direct `ReactElement` page return composed by the application `renderPage` callback with
  manifest-derived hydration options.
- A `Suspense` boundary whose fallback and resolved recommendation content are emitted by Web
  Streams SSR.
- A Vite client build that writes `dist/client/.vite/manifest.json`, then
  `@fluojs/react/vite` turns that loaded manifest into ordered CSS and hydration module assets.
- A server-rendered counter that becomes interactive through React DOM `hydrateRoot(...)`.
- `@fluojs/react/client` route snapshots, URL-state hooks, progressive `Link`, and full-document
  `push` navigation that still reaches the server-owned DTO validation boundary.
- A native `multipart/form-data` form that reaches an ordinary guarded/intercepted `@Post(...)`
  route, mutates application state, and returns `303 See Other` to an HTTP-matched destination.
- Production browser coverage that submits that form with JavaScript disabled.
- A production build served by the Fastify adapter, including the generated Vite client assets.

## run from the repo root

```sh
pnpm install
pnpm build
pnpm --filter @fluojs/example-react-vite-ssr build
pnpm --filter @fluojs/example-react-vite-ssr start
```

Open `http://127.0.0.1:3000/products/sku-42?preview=true`, then activate `Count: 0`. The label
changes to `Count: 1` only after the Vite-generated client entry hydrates the server HTML. Use
`Open sku-84` or `Push sku-126` to perform same-origin full-document navigation; each destination
is matched, bound, and validated again by the fluo HTTP route.

Run the repeatable SSR and hydration checks with:

```sh
pnpm vitest run examples/react-vite-ssr
pnpm --filter @fluojs/example-react-vite-ssr test:browser
```

The browser command rebuilds workspace packages plus the example, starts the built server, and runs
Chrome coverage for both the production client entry and a JavaScript-disabled context. It fails on
missing or non-200 bootstrap/style assets, hydration warnings or errors, an identifier-prefix
mismatch, a counter that does not hydrate, client navigation whose URL and server-rendered route
state do not agree, or a native form that cannot complete its `POST` → `303` → `GET` flow.

## canonical consumer test map

This example is the outer half of the canonical React consumer loop, while package and CLI fixtures
cover the smaller units and generated types:

| layer | executable evidence |
| --- | --- |
| Render-policy unit | `packages/react/src/render-policy.test.ts` covers composition and diagnostics directly. |
| Real request dispatch | `src/app.test.ts` uses `createTestApp(...)` for a direct page return, DTO failures, guard/interceptor behavior, and native mutation responses. |
| Generated-route compile/check | `packages/cli/src/commands/typegen-navigation.test.ts` compiles positive and negative route-id/params fixtures; `typegen.test.ts` covers non-mutating stale checks. |
| Hydration | `src/hydration.test.ts` covers both warning-free interaction and mismatch reporting through `onRecoverableError`. |
| Production and no JavaScript | `tests/production-hydration.spec.ts` verifies built assets and hydration, then submits the native form with `javaScriptEnabled: false`. |

No React-specific testing helper is added. Ordinary fixtures remove repeated setup while
`createTestApp(...)`, React DOM, TypeScript, and Playwright continue to exercise the real ownership
boundaries.

## native form mutation workflow

`ProductDocument` renders a real form with a label, required input, submit button, ordinary route
action, and explicit multipart encoding:

```html
<form action="/products/sku-42" enctype="multipart/form-data" method="post">
  <label for="product-name">Product name</label>
  <input id="product-name" minlength="3" name="name" required />
  <button type="submit">Save product</button>
</form>
```

The receiving method is an ordinary `@Post('/:sku')` handler on the same HTTP-owned router. It binds
path and body fields with `@RequestDto(...)`, runs `CatalogMutationGuard`, runs the request-scoped
`CatalogMutationInterceptor`, mutates the singleton example catalog, and calls
`context.response.redirect(303, ...)`. `CatalogRequestMiddleware` remains in the module middleware
chain. The focused authorization fixture uses `x-example-user: catalog-editor`; replace it with the
same session/cookie and CSRF policy used by the rest of your application.

Invalid input returns the canonical `400` validation envelope with safe field/source/code/message
details. Successful input redirects to `/products/:sku?updated=true`; that `GET` destination is
matched, bound, and rendered again by the ordinary dispatcher. The browser regression creates a
Chrome context with `javaScriptEnabled: false`, submits the rendered form, observes the `303`, and
asserts the destination document contains the mutated value.

This flow is not a React Router action/fetcher, Astro Action, Next.js Server Action, or experimental
fluo Server Function. It does not compile action ids, own route matching, revalidate a client cache,
or promise optimistic state. No submit-state helper is added because the native form already provides
the complete fallback and the stable client package owns neither mutation routes nor cache policy.

## phase boundaries and limitations

- The stable `0.1.0` root contract still owns HTTP-first React SSR. This `0.2.0` example composes
  that contract with the `@fluojs/react/vite` manifest parser added after the initial SSR example.
- Direct page returns do not create a second response path: the application renderer still returns
  `ReactServerEntry`, and the existing HTTP writer owns status, headers, errors, and streaming.
- `src/entry-client.ts` is the browser-only boundary. Server modules do not access `window` or
  `document`, and the server loads the Vite manifest explicitly from the application boundary.
- `ReactClientRouterProvider` receives the same request URL and HTTP-matched params during SSR and
  hydration. `Link`, `router.push(...)`, and `router.replace(...)` use full-document navigation, so
  redirects, not-found pages, DTO validation failures, guards, interceptors, and server errors remain
  ordinary HTTP responses.
- This example does not promise SPA document swapping, event replay, client route matching,
  navigation caches, RSC-aware data, or prefetch behavior.
- This is not a Next.js App Router, file-based router, TanStack route tree, RSC example, catch-all
  route example, or production starter-template change.
- The asset controller is intentionally minimal and serves the flat filenames emitted by this
  example's Vite config. A production deployment should normally place built assets behind its
  established static-file or CDN boundary.

## project structure

```txt
examples/react-vite-ssr/
├── src/
│   ├── app.ts              # @Router pages, native POST mutation, and Vite asset serving module
│   ├── app.test.ts         # DTO, protected mutation, redirect, and streamed SSR assertions
│   ├── entry-client.ts     # Browser-only hydrateRoot(...) entry
│   ├── entry-server.ts     # Explicit Vite server-entry selector
│   ├── hydration.ts        # Shared server/client identifierPrefix
│   ├── hydration.test.ts   # Aligned interaction and recoverable mismatch reporting
│   ├── main.ts             # Loads the generated manifest and starts Fastify
│   ├── page.ts             # Shared document, native form, client router, and interactive counter
│   └── recommendations.ts  # Lazy Suspense content
├── tests/
│   └── production-hydration.spec.ts # Hydration and JavaScript-disabled form regressions
├── playwright.config.ts
├── vite.client.config.ts
├── vite.server.config.ts
├── README.md
└── README.ko.md
```

## related docs

- `../react-stable-ssr/README.md` — the explicit-asset `0.1.0` SSR baseline
- `../../packages/react/README.md` — React package and Vite manifest contracts
- `../../packages/vite/README.md` — TC39 decorator transform boundary for Vite builds
- `../../docs/contracts/behavioral-contract-policy.md` — behavior/docs/test alignment rules
