# React Navigation Payload Contract

<p><strong><kbd>English</kbd></strong> <a href="./react-navigation-payload.ko.md"><kbd>한국어</kbd></a></p>

## Scope and ownership

`@fluojs/react` supports an opt-in representation for an HTTP-matched `@Path(...)` GET whose
handler returns `ReactNavigationPage.create(page, { module, props })`. The normal result is still a
streamed React document through the configured `ReactModule.forRoot({ renderPage })`. The `module`
is an application-authored browser module identity: the application checks its loaded Vite
manifest for that destination and supplies a build-produced `import.meta.glob(...)` importer map
in the browser. It is not a URL pattern, a dynamically constructed import URL, or a React matcher.
The root entrypoint neither imports Vite nor loads browser code.

HTTP owns route matching, URI/version selection, middleware, DTO materialization and validation,
guards, interceptors, request-scoped providers, response headers, status, error negotiation, abort,
and final writing. No navigation payload is produced for plain handler values, errors, unmatched
routes, redirects, or unmarked React pages. The representation protocol version `1` is independent
of an HTTP route's URI version.

## Negotiation and result

A client sends a GET with exactly
`Accept: application/vnd.fluo.react-navigation+json;v=1`. On a successful opted-in page, HTTP
returns JSON with that media type (a host may serialize its `v` parameter as `"1"` and add
`charset=utf-8`). It adds `Accept` to existing `Vary`, retains `Set-Cookie` and other headers,
and appends `private, no-store` to an existing `Cache-Control` value. No client or intermediary
may reuse a navigation result, especially one influenced by cookies or authentication.
The configured page renderer's entry status and headers apply to both the document and negotiated
result without opening an HTML stream for the negotiated result. A non-2xx renderer status (for
example `404`) is still rejected by the browser helper and takes the full-document fallback.

```json
{
  "version": 1,
  "url": "/products/sku-84?preview=false",
  "params": { "sku": "sku-84" },
  "destination": {
    "module": "./navigation-product.ts",
    "props": { "sku": "sku-84", "preview": false }
  }
}
```

`url` and `params` come from the active HTTP request after matching, not from client parsing.
`props` must be JSON-serializable application data. Serialization failures occur before a
navigation response commits and follow the existing canonical HTTP error path. Request-scoped
dependencies remain active through response writing and are disposed by the normal dispatcher.
For ordinary document GETs, React owns the HTML Web Stream while HTTP owns the sink: failed or
aborted rendering never commits partial buffered HTML, and early sink close or write failure
cancels the unfinished reader and releases its lock.

Without that exact Accept value (including direct and JavaScript-disabled GETs), the page
streams its unchanged HTML shell and hydration assets. Successful HTML varies by `Accept` when an
alternative is available. `HEAD` and other methods do not select the navigation representation.
The existing HTML error/not-found negotiation and canonical JSON errors remain HTTP-owned; an
error document must never be parsed as a page payload.

## Browser consumption and fallback

`loadReactNavigationDestination(href, modules, { signal? })` from
`@fluojs/react/client` accepts same-origin HTTP(S) only. It makes one uncached request with
`credentials: 'same-origin'`, `cache: 'no-store'`, `redirect: 'manual'`, and the explicit Accept
header. Browser cookie handling, including `Set-Cookie`, stays with the browser; the helper
never stores responses or prefetches. It validates status, media type, protocol version,
server-confirmed same-origin URL, string path params, JSON-object props, and a module key present
in the supplied build-produced importer map **before** importing or rendering anything.
It also requires the loaded module to export a usable default component before reporting success.
Malformed JSON, unsupported versions/modules/URLs, non-HTML or other unexpected media types,
network errors, redirects, 404, 401/403, DTO failures, and server failures return a non-success
result for an application-owned full-document fallback. Cancellation returns `cancelled` and
does not import or render, including when cancellation occurs during the response body read, or
initiate fallback navigation. An external or non-HTTP(S) URL is rejected before
any fetch; use a normal anchor for it.

The browser does not rewrite React-owned HTML, infer path params, or install a route matcher.
Pass the build-produced importers as `navigationModules` to `ReactClientRouterProvider` and
render its function child with the approved destination in the application-owned page slot.
The existing `Link` and `router.push/replace` request that result before changing the URL.
On success the provider commits the server-confirmed URL and params with the History API, mounts
the loaded component afresh, and updates all route hooks while retaining the common provider and
layout. The application must choose a focus policy; the runnable example focuses `<main>` after
a pathname transition while preserving its shell counter and resetting the page counter.

`popstate` and forward traversal request fresh HTTP approval; they never reuse prior private
payloads or attach old params to a new URL. A late result after another activation or unmount
cannot commit. Repeated activation of an in-flight destination does not issue another request.
Fragment-only changes keep the browser's native same-document history behavior. A failed or
unsupported load uses a full-document `assign`/`replace` without committing a guessed soft URL;
for history traversal the browser URL has already changed, so failure loads its document.
Cancellation does not start fallback. Before hydration, `Link` remains a native anchor, and
the initial request snapshot must match the browser path/search rather than silently installing
another page. `refresh()` remains a document reload. There is no prefetch or reusable cache.

## Evidence and limits

`packages/react/src/navigation-payload.test.ts` exercises the real HTTP dispatcher, URI version,
DTO binding, guard, interceptor, middleware, scope, redirect, error, cancellation, and header boundaries.
`packages/react/src/client-navigation-payload.test.ts` exercises browser parsing, cookie-bearing
requests, rejection, non-reuse, and cancellation.
`packages/react/src/client.test.ts` covers history, stale results, and fallback through the public
router store.
`examples/react-vite-ssr/src/app.test.ts` covers DTO validation, and it and
`examples/react-vite-ssr/tests/production-hydration.spec.ts` exercise the manifest-bound
destination, browser rendering, ordinary HTML, and no-JavaScript document behavior.
This stable SSR/Vite representation is JSON plus a built client component, not experimental
Flight, a generic React tree serializer, or a file-routing contract.
