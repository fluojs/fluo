# react-vite-ssr example

## Background interaction companion

Open `/catalog/login`, then `/catalog/background`. The real song datasource
supports native GET search and independent enhanced search/widget results; each
stable song row sends its own guarded queue POST. Acknowledgements leave
URL/history/head unchanged and confirmed writes share fresh current-page approval.
Cancellation is not server rollback. App queue rules, persistence and idempotency
stay application-owned. See the [form contract](../../docs/contracts/react-progressive-forms.md).

For deterministic production verification, build with
`REACT_VITE_FORM_TEST_SERVER=1 pnpm build`, then run
`pnpm exec playwright test tests/background-interactions.spec.ts`.
The explicit test entry extends `FormControl` started/release/cleaned barriers;
normal production startup installs no fault routes. The packaged starter exercises
the same fixture through actual `dev` and `build`/`start`. This is not a soak or
performance measurement.

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Session acceptance also exercises `?legacySession=1` with plain provider children
and no session configuration, and `?authRefresh=1` with one app-selected fresh
auth read. These example fixture variants verify safe document exit and configured
GET/POST auth policy consumption; they are not alternate framework APIs.

Minimal Vite-backed `@fluojs/react` application for the hydration and client-navigation phases. It connects
HTTP-owned page routes, DTO-bound parameters, streamed React SSR, Vite manifest assets, and one
hydrated browser runtime with a progressively enhanced native mutation form, without introducing a
second routing model.

This example documents the production manifest/hydration path and is not the
generated starter's `fluo dev` HMR host. For the supported Node React Fast
Refresh and CSS HMR path, generate `fluo new --starter react-vite-ssr`; the
[migration guide](../../docs/getting-started/migrate-react-dev-hmr.md) explains
how to update an older generated app without adding another Vite process.

For ordinary second and third pages, start from the official generated
`react-vite-ssr` composition instead: its `src/page*.tsx` importer glob and
HTTP handlers share a bounded, escaped initial transfer with subsequent soft
navigation. This example intentionally retains the lower-level application-owned
document and navigation modules to exercise native POST, public prefetch, CSP
nonce and focus policy. It is not an alternative recommended bootstrap path;
the [starter composition migration](../../docs/getting-started/migrate-react-starter-composition.md)
connects custom documents to the same handler-selected transfer.

This is evidence for shipped SSR, hydration, native POST/303/GET, approved navigation
and opt-in transient navigation preservation, **not** the complete operations CRUD or
long-lived jukebox gate. The [HTTP-first React product contract](../../docs/contracts/react-fullstack-product.md)
maps each additional user journey and its owner. This example opts into network/5xx and
recoverable import-failure preservation through the same
`failurePolicy` and offers `retry()` and `openDocument()` while preserving an actual
long-lived resource with operation/ack and mount/cleanup observations. Low-level providers
without opt-in still use document fallback; the official starter explicitly selects
network/5xx and recoverable mapped import-failure preservation and recovery controls.
`router.refresh()` now revalidates the current HTTP page without discarding the shell. It returns
a typed completion result; explicit document reload uses `window.location.reload()`.
See the [consumer migration](../../docs/getting-started/migrate-react-refresh.md).

## what this example demonstrates

- `@Router('/products')` and `@Path('/:sku')` page routes discovered by the fluo HTTP module graph.
- Typed path and search input through `@RequestDto(...)`, `@FromPath('sku')`, and
  `@FromQuery('preview')`.
- An opted-in `ReactNavigationPage` whose ordinary document response is composed by the
  application `renderPage` callback with manifest-derived hydration options.
- A `Suspense` boundary whose fallback and resolved recommendation content are emitted by Web
  Streams SSR.
- A Vite client build that writes `dist/client/.vite/manifest.json`, then
  `@fluojs/react/vite` turns that loaded manifest into ordered CSS and hydration module assets.
- A server-rendered counter that becomes interactive through React DOM `hydrateRoot(...)`.
- `@Router('/admin')` pages at `/admin/qr` and `/admin/songs` with HTTP-approved soft navigation
  that preserves the interactive shell, resets destination state, and focuses `<main>`.
- `@fluojs/react/client` route snapshots, URL-state hooks, progressive `Link`, and
  `push/replace/back` with document fallback and server-owned DTO validation.
- Explicit `Link prefetch="hover"|"viewport"` and provider `prefetchScope` opt-in: a
  server-declared public destination can be consumed once after anonymous prefetch.
  Private, no-store, Set-Cookie, Vary Cookie, redirect, missing, and auth fixtures
  demonstrate denied reuse and ordinary credentialed navigation.
- A native `multipart/form-data` form that reaches an ordinary guarded/intercepted `@Post(...)`
  route, mutates application state, and returns `303 See Other` to an HTTP-matched destination.
- Production browser coverage that submits that form with JavaScript disabled.
- A production build served by the Fastify adapter, including the generated Vite client assets.
- Failure-injected production Chrome tests of network and 5xx rejection, fresh retry,
  back/forward recovery and resource identity/operation acknowledgment; the shell
  resource probe exposes `window.__reactResource` and `window.__reactResourceStats`
  for bounded long-session fixture checks (#3886).

## run from the repo root

```sh
pnpm install
pnpm build
pnpm --filter @fluojs/example-react-vite-ssr typegen
pnpm --filter @fluojs/example-react-vite-ssr build
pnpm --filter @fluojs/example-react-vite-ssr start
```

The explicit first generation uses the exported inspection `AppModule` and
`applicationOptions` from the same HTTP factory as runtime startup. It needs no
production manifest and never listens. Actual startup supplies the real assets
and document renderer from `src/presentation.ts`; an unconfigured inspection
root cannot render pages or serve assets.

The generated `reactPageRoutes`, `reactPageModules` and `reactFormRoutes` connect
authored component props, HTTP query/control aliases and existing `useForm`
bindings. Initial hydration and ordinary/prefetch loads share the same generated
props decoders through `navigationContracts`. Typecheck/build begin with
non-mutating `--check`; after source/type/config edits, explicitly rerun
`typegen` or use `typegen:watch`. A stale artifact is not silently regenerated.

Open `http://127.0.0.1:3000/products/sku-42?preview=true`, then activate `Count: 0`. The label
changes to `Count: 1` only after the Vite-generated client entry hydrates the server HTML. Use
`Open sku-84` or `Push sku-126` to navigate without replacing the document after HTTP approval.
Open `/admin/qr`, increment both counters, follow `Open admin songs`, then use `Back` and browser
forward: the URL and page follow HTTP's confirmed destination; the shell counter persists, the
page counter resets, and the main landmark receives focus. Direct and no-JavaScript requests
still render ordinary server documents.
The `Probe shell resource` button sends a real `MessageChannel` operation and displays its
instance ID and acknowledgement sequence; after an approved page render error and local reset,
the same resource still acknowledges the next operation. `Open throwing destination` exercises
the page-local reset without another HTTP request, while `Open throwing error view` exercises
the safe outer diagnostic/document exit. A deferred approval keeps the previous page interactive
and announces pending; approved `@PageMetadata(...)` changes title, description and canonical
link without removing the global icon or Vite stylesheet.

The example's provider opts into preserving `network`, `server-error`, and `import-failure`. When an
approved page load fails, the shell keeps its page, URL, resource instance and functional
`Use shell resource` control; `Retry navigation` makes a new HTTP request and `Open full
document` is an explicit exit. Other reasons, including authentication, redirect, DTO
and invalid payload, keep document fallback. A production browser checks these outcomes
without paid media credentials; the generated starter independently verifies its own default.
Neither fixture proves actual music playback or logout persistence.
For the no-policy browser fixture, open `/admin/qr?defaultNavigation=1`: navigation still
uses HTTP approval, but invalidating an untagged back entry loads its ordinary document.

From `/admin/qr`, hover `Prefetch public sku-84` or scroll to `Prefetch public on viewport`,
then activate the opted-in link. The first GET fetches a public navigation representation;
activation consumes it without another GET. `Open public sku-84 without prefetch` still makes
a normal request. `Switch user and prefetch scope` changes the demo cookie and uses
`router.sessionChanged` to revoke the previous provider approval before fresh HTTP;
the public prefetch label is not a competing session notifier. `Rename without reload` sends
 a guarded POST and calls `router.invalidate()` after success. Click `Refresh` to fetch and
 display the changed server value in the same page without a history entry; pending and
 preserved failure retain the last approved value. The other fixture links show
that prefetch rejection never substitutes an anonymous result for a private destination.

Run the repeatable SSR and hydration checks with:

```sh
pnpm vitest run examples/react-vite-ssr
pnpm --filter @fluojs/example-react-vite-ssr test:browser
```

The browser command rebuilds workspace packages plus the example, starts the built server, and runs
Chrome coverage for prefetch request counts and rendered destinations as well as the production
client entry and a JavaScript-disabled context. It fails on
missing or non-200 bootstrap/style assets, hydration warnings or errors, an identifier-prefix
mismatch, a counter that does not hydrate, client navigation whose URL and server-rendered route
state do not agree, or a native form that cannot complete its `POST` → `303` → `GET` flow.

## negotiated destination workflow

`src/presentation.ts` verifies the application-loaded Vite manifest contains
`src/navigation-product.ts`, then the matched product handler returns
`ReactNavigationPage.create(ProductDocument, { module: './navigation-product.ts', props })`.
An ordinary document GET still streams the HTML shell, hydration scripts, Suspense content,
and request URL. An explicit `Accept: application/vnd.fluo.react-navigation+json;v=2` GET
instead runs the same HTTP DTO and module pipeline and returns the server URL/params and
browser destination. `src/entry-client.ts` passes a Vite-compiled `import.meta.glob(...)`
map to `ReactClientRouterProvider` as `navigationModules` and validates the escaped inert
initial transfer before hydration. The shell's `ReactNavigationExperience` provides the
opt-in render boundary, polite status, focus/scroll defaults and page-owned head. Existing `Link` and
`router.push/replace` validate the HTTP result through the client loader before committing
history and rendering a fresh destination in the page slot. `src/admin-page.ts` and its
build-mapped `src/navigation-admin.ts` entry handle
both admin pages; the shared counter stays mounted. `popstate` and forward fetch fresh results.
The complete Vite manifest and same-origin `/assets/` base produce one `buildId` for
`ReactModule.forRoot({ navigationBuildId })`, the inert initial transfer and the client
provider. An A tab encountering B retains its approved page/resource on
`incompatible-build`, with an explicit update/document action; missing mapped chunks
remain `import-failure` and unknown keys remain `unsupported-module`. See the
[deployment recipe](../../docs/guides/react-production-deployment.md).

Ordinary navigation sends same-origin cookies, follows `Set-Cookie` through normal browser
handling, and uses `cache: 'no-store'`. Prefetch is off unless a `Link` explicitly requests
`hover` or `viewport` and the provider has both `navigationModules` and `prefetchScope`.
`PrefetchPageRouter` calls `ReactNavigationPage.create(node, destination, { prefetch: 'public' })`
only for identity-independent fixtures; the response is reusable only when HTTP grants
`X-Fluo-Navigation-Prefetch: public` alongside compatible `Cache-Control` and `Vary` headers.
That request omits credentials and cannot safely infer an authenticated representation.
The example's `public-*` content is shared across users: never declare a page public if
its output depends on cookies, authorization, identity headers, or IP. Cache entries are
provider-local, single-use, and expire within 15 seconds; at most 32 entries, 64 KiB per entry,
and four simultaneous requests are admitted. Scope changes, `router.invalidate()`, and
document teardown clear them. A redirect, error,
invalid/unsupported payload, or unavailable module triggers ordinary document fallback;
cancelled loads do not. Private/no-store, Set-Cookie, unsupported Vary, credential-bearing,
or otherwise ungranted responses cannot become reusable entries. Auth and mutation boundaries
are the application's responsibility; an external HttpOnly cookie update cannot automatically
invalidate a provider cache. The example also gives streamed React bootstrap/Suspense scripts
per-response CSP nonces so the production Fastify security policy allows hydration without
loosening its default script policy. See the
[navigation payload contract](../../docs/contracts/react-navigation-payload.md).

## canonical consumer test map

This example is the outer half of the canonical React consumer loop, while package and CLI fixtures
cover the smaller units and generated types:

| layer | executable evidence |
| --- | --- |
| Render-policy unit | `packages/react/src/render-policy.test.ts` covers composition and diagnostics directly. |
| Real request dispatch | `src/app.test.ts` uses `Test.createApp(...)` for an opted-in page, DTO failures, guard/interceptor behavior, and native mutation responses. |
| Generated-route compile/check | `packages/cli/src/commands/typegen-navigation.test.ts` compiles positive and negative route-id/params fixtures; `typegen.test.ts` covers non-mutating stale checks. |
| Hydration | `src/hydration.test.ts` covers both warning-free interaction and mismatch reporting through `onRecoverableError`. |
| Production and no JavaScript | `tests/production-hydration.spec.ts` verifies built assets and hydration, then submits the native form with `javaScriptEnabled: false`. |

No React-specific testing helper is added. Ordinary fixtures remove repeated setup while
`Test.createApp(...)`, React DOM, TypeScript, and Playwright continue to exercise the real ownership
boundaries.

The isolated [same-app performance comparison](../../docs/guides/react-performance-benchmarks.md)
uses a larger seeded workload and separate correctness and timing gates; this example's
production hydration check alone is not a four-framework performance measurement.

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
- Opted-in page returns do not create a second response path: the application renderer still returns
  `ReactServerEntry`, and the existing HTTP writer owns status, headers, errors, and streaming.
- `src/entry-client.ts` is the browser-only boundary. Server modules do not access `window` or
  `document`, and the server loads the Vite manifest explicitly from the application boundary.
- `ReactClientRouterProvider` receives the same request URL and HTTP-matched params during SSR and
  hydration. Approved pages use soft navigation; redirects, not-found pages, DTO failures, and
  errors fall back to ordinary HTTP documents. Guards and interceptors remain server-owned.
- This example does not promise arbitrary HTML swapping, event replay, client route matching,
  a global navigation cache, RSC-aware data, or prefetch for non-opted-in links.
- A failed network/5xx soft load does not yet preserve the jukebox shell by default;
  this example's fallback test deliberately observes the current full-document path.
  Auth rejection, explicit reload and application logout are distinct from transient retry.
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
│   ├── admin-page.ts       # Shared admin page component with destination-local state
│   ├── entry-client.ts     # Browser-only hydrateRoot(...) entry
│   ├── navigation-product.ts # Vite-built browser destination component
│   ├── navigation-admin.ts # Build-mapped admin destination entry
│   ├── prefetch-page.ts    # Public and restricted HTTP prefetch fixtures
│   ├── entry-server.ts     # Explicit Vite server-entry selector
│   ├── hydration.ts        # Shared server/client identifierPrefix
│   ├── hydration.test.ts   # Aligned interaction and recoverable mismatch reporting
│   ├── main.ts             # Loads the generated manifest and starts Fastify
│   ├── page.ts             # Shared document, native form, client router, and interactive counter
│   └── recommendations.ts  # Lazy Suspense content
├── tests/
│   ├── prefetch.spec.ts    # Built-browser public prefetch and history outcomes
│   ├── prefetch-boundaries.spec.ts # Private, auth, mutation, and fallback outcomes
│   ├── prefetch-limits.spec.ts # Browser cache and concurrency bounds
│   ├── prefetch-helpers.ts # Shared browser request observers
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


## Progressive native HTTP forms

The [progressive form contract](../../docs/contracts/react-progressive-forms.md) connects `useForm` in the existing
provider with root `ReactModule.formResult` through one native HTTP path. HTTP
still owns DTO/guard/interceptor, request scope, status and errors; native
POST/303/GET remains. Distinguish confirmed `saved` from a failed follow-up read,
and validation/auth from uncertain persistence. `retryRead()` repeats only GET.
Busy activation is skipped; no POST is automatically retried or replayed.
Automatic form refresh retains unrelated form input/errors/focus and the shell;
existing explicit `useRouter().refresh()` still resets page state after approval.

Open `/catalog/login`, then `/catalog` or `/catalog/sku-42` for create/read/update/delete.
Its process-local map and demo cookie are not durable persistence or production auth.
`tests/progressive-forms.spec.ts` exercises JS-disabled/bootstrap-blocked journeys
and real-listener barriers, cookies/CSRF, disconnects, manual redirects and GET-only
recovery. Normal production uses `src/main.ts`; `REACT_VITE_FORM_TEST_SERVER=1`
selects `tests/form-server.ts` only for explicit fault injection.

## Navigation permission

Enable **Protect edits** on the catalog editor, then edit or submit the existing `useForm`. One `useNavigationGuard` decision offers **Stay here** or **Proceed with navigation**. Stay retains drafts without destination HTTP or form cancellation; after permission fresh HTTP approves the page. Cancelling a pending POST is not server rollback. Logout/401/403 revoke an open decision. JS-disabled/native submission remains unchanged.

See [guard migration](../../docs/getting-started/migrate-react-navigation-guards.md) and the [owning contract](../../docs/contracts/react-navigation-payload.md#navigation-permission).
