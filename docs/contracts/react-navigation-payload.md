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
routes, redirects, or unmarked React pages. The representation protocol version `2` is independent
of an HTTP route's URI version.

For an identity-independent page only, the handler may opt into speculative reuse with
`ReactNavigationPage.create(page, { module, props }, { prefetch: 'public' })`. The optional third
argument makes an application assertion that the representation is identical across users,
authentication, cookies, and every other request identity. Omitting it retains the private default.

## Negotiation and result

A client sends a GET with exactly
`Accept: application/vnd.fluo.react-navigation+json;v=2`. On a successful opted-in page, HTTP
returns JSON with that media type (a host may serialize its `v` parameter as `"2"` and add
`charset=utf-8`). It adds `Accept` to existing `Vary` and retains `Set-Cookie` and other headers.
Ordinary navigation appends `private, no-store` to an existing `Cache-Control` value, including
when the page explicitly asserts `prefetch: 'public'`; a credentialed ordinary result is never
reusable. Only an explicit public page requested without `Cookie` or `Authorization` can receive
`X-Fluo-Navigation-Prefetch: public`, `Cache-Control: public, max-age=15`, and `Vary: Accept`.
HTTP grants this only after finalizing a status-`200` negotiated response with **no final
`Set-Cookie`**, **no pre-existing `Cache-Control` directive of any kind**, and **no pre-existing
`Vary` other than `Accept`**. A failed condition never creates a grant or overwrites an
application restriction to manufacture eligibility: the ordinary `private, no-store` response
policy remains in force. In particular, pre-existing `public`, `private`, or `no-store`,
`Vary: Cookie` or `Vary: *`, request credentials, redirects, and errors deny reuse. Plain
HTML, `HEAD`, and other methods never receive a navigation-prefetch grant.
The configured page renderer's entry status and headers apply to both the document and negotiated
result without opening an HTML stream for the negotiated result. A non-2xx renderer status (for
example `404`) is still rejected by the browser helper and takes the full-document fallback.

```json
{
  "version": 2,
  "buildId": "<sha256-of-complete-manifest-and-base>",
  "url": "/products/sku-84?preview=false",
  "params": { "sku": "sku-84" },
  "destination": {
    "module": "./navigation-product.ts",
    "props": { "sku": "sku-84", "preview": false }
  },
  "metadata": {
    "title": "Product sku-84",
    "meta": [{ "name": "description", "content": "Product sku-84" }],
    "links": [{ "rel": "canonical", "href": "/products/sku-84?preview=false" }]
  }
}
```

`buildId` is required and derived by `createReactViteAssetManifest(...)` from the complete
manifest (including lazy chunks) and public base. Pass the resulting identity to
`ReactModule.forRoot({ navigationBuildId })` and
`ReactClientRouterProvider.navigationBuildId`. No missing or conflicting identity can
approve a soft destination. `url` and `params` come from the active HTTP request after
matching, not from client parsing.
Optional `metadata` comes from the same matched page's broad-to-specific `@PageMetadata(...)`
factories, resolved within its request scope for both document transfer and negotiated JSON.
The page-owned subset is title (at most 512 characters), at most 32 `name`/`property` meta
descriptors and 32 `rel`/`href` link descriptors (each value at most 2048 characters).
Link hrefs are root-relative or HTTP(S); duplicate descriptor identities and malformed values
fail before an HTTP commit or browser import. The escaped initial transfer retains its 64 KiB
UTF-8 ceiling. Unmarked pages do not acquire metadata implicitly.
`props` must be JSON-serializable application data. Serialization failures occur before a
navigation response commits and follow the existing canonical HTTP error path. Request-scoped
dependencies remain active through response writing and are disposed by the normal dispatcher.
For opted-in ordinary document GETs, the page renderer additionally receives an optional
fourth `ReactInitialNavigationPage` argument. It contains the same HTTP-approved URL, matched
params, module and JSON-normalized props, plus `json` for an inert `application/json` script.
The server escapes `<`, `>`, `&`, U+2028 and U+2029 before embedding, then enforces a 64 KiB
UTF-8 limit on the escaped transfer. Unserializable or oversized initial data fails before any
HTML commit through the existing HTTP error response. The application renderer checks the
selected module against its loaded Vite manifest (or development build importer set), then
embeds the escaped transfer; it must not include DI instances, secrets or server-only imports in
the browser component graph. The browser calls
`loadReactInitialNavigationDestination(json, modules, buildId)` with the same build-produced importer
map used for subsequent `Link`/`useRouter` navigation; this validates build identity, URL, params, module and
component before hydration, without a second HTTP request or client URL matcher. The generated
starter composes both the initial page and subsequent destinations in one shared provider,
retaining the shell and resetting destination-local state at the page slot. A normal
`ReactElement` and an explicit `ReactServerEntry` do not acquire an implicit transfer.
For ordinary document GETs, React owns the HTML Web Stream while HTTP owns the sink: failed or
aborted rendering never commits partial buffered HTML, and early sink close or write failure
cancels the unfinished reader and releases its lock.

Without that exact Accept value (including direct and JavaScript-disabled GETs), the page
streams its unchanged HTML shell and hydration assets. Successful HTML varies by `Accept` when an
alternative is available. `HEAD` and other methods do not select the navigation representation.
The existing HTML error/not-found negotiation and canonical JSON errors remain HTTP-owned; an
error document must never be parsed as a page payload.

## Browser consumption and fallback

`loadReactNavigationDestination(href, modules, { buildId, signal? })` from
`@fluojs/react/client` accepts same-origin HTTP(S) only. Each ordinary load makes one uncached
request with
`credentials: 'same-origin'`, `cache: 'no-store'`, `redirect: 'manual'`, and the explicit Accept
header. Browser cookie handling, including `Set-Cookie`, stays with the browser; the helper never
uses browser-visible `Set-Cookie` to decide cache eligibility (Fetch filters that header).
Ordinary navigation never stores its response. The browser validates status, media type, protocol version,
required build identity against its hydrated document, and
server-confirmed same-origin URL, string path params, JSON-object props, and a module key present
in the supplied build-produced importer map **before** importing or rendering anything.
It also requires the loaded module to export a usable default component before reporting success.
Malformed JSON, unsupported versions/modules/URLs, unexpected media types,
network errors, redirects, 404, 401/403, DTO failures, and server failures return a distinct
non-success reason for an application-owned full-document fallback. Cancellation returns `cancelled` and
does not import or render, including when cancellation occurs during the response body read, or
initiate fallback navigation. An external or non-HTTP(S) URL is rejected before
any fetch; use a normal anchor for it.
#3864's separate opt-in failure policy can preserve a failure of a **mapped** importer as
`import-failure` alongside transient network/server errors, with fresh retry and explicit
document exit outside this page slot. An unknown importer key remains `unsupported-module`
and takes the document path; neither case is an approved React render throw.

The browser does not rewrite React-owned HTML, infer path params, or install a route matcher.
Pass the build-produced importers as `navigationModules` and their matching
`navigationBuildId` to `ReactClientRouterProvider` and
render its function child with the approved destination through `ReactNavigationExperience`
in the application-owned page slot. This is an opt-in official composition; installing the
package does not change low-level provider navigation effects. Its pending status remains outside
the destination boundary while the last approved page, URL, params and head stay in place.
An approved destination render throw keeps that committed URL/params and the shell, presents a
keyboard-operable local render reset without a second HTTP request or history entry, and
distinguishes a throwing application error view via a separate outer diagnostic/document exit.
An unrecoverable shell/root or closed browser cannot retain that shell.
The same composition renders only page-owned title/meta/link entries for the approved snapshot;
React reconciles additions and removal without taking ownership of bootstrap, icon or global
stylesheet entries. It announces pending, completion and failure through a polite live region.
This composition requires React 19 and React DOM 19 for SSR and soft-navigation hoisting of
page-owned metadata into `<head>`; the wider React 18 peer range applies to other package APIs,
not this head-reconciliation guarantee.
For pathname push/replace it focuses `<main>` without focus scrolling then scrolls to top;
query-only changes focus `<main>` while preserving scroll; fragment-only moves keep native
fragment scrolling and focus an eligible target; back/forward focus `<main>` without replacing
browser-restored scroll. `onApprovedNavigation` replaces those effects for an application-specific
policy. Pending or failed approval does not change focus or scroll.
The existing `Link` and `router.push/replace` request that result before changing the URL.
On success the provider commits the server-confirmed URL and params with the History API, mounts
the loaded component afresh, and updates all route hooks while retaining the common provider and
layout. The application must choose a focus policy; the runnable example focuses `<main>` after
a pathname transition while preserving its shell counter and resetting the page counter.

`popstate` and forward traversal request fresh HTTP approval; they never reuse prior private
payloads or attach old params to a new URL. A late result after another activation or unmount
cannot commit. Repeated activation of an in-flight destination does not issue another request.
Fragment-only changes keep the browser's native same-document history behavior. Without an
opted-in policy, a failed or unsupported load uses full-document `assign`/`replace` without committing a guessed soft URL;
for history traversal the browser URL has already changed, so failure loads its document.
Cancellation does not start fallback. Before hydration, `Link` remains a native anchor, and
the initial request snapshot must match the browser path/search rather than silently installing
 another page. `refresh()` uses the same ordinary loader when a soft destination is available. Non-opt-in `Link`, `router.push/replace`,
and rejected prefetches still use the credentialed ordinary loader and its full-document fallback.

`ReactClientRouterProvider` accepts optional `failurePolicy(failure)`, returning `'preserve'`
or `'document'` synchronously or asynchronously. Without it the low-level default stays document
fallback. The policy and `useNavigation().failure` expose only a public `reason`, destination
**pathname** (not query, body, credentials or exception internals), and navigation `type`.
Reasons distinguish `network`, `server-error` (HTTP 5xx), `unauthorized` (401), `forbidden`
(403), `redirect`, `not-found` (404), `dto-rejected` (400/422), `invalid-payload`,
`unsupported-module`, `import-failure`, `unavailable` (other response), and
`unsupported-destination`, and `incompatible-build` (v2 identity mismatch before import);
cancellation never invokes the policy. Network and 5xx can be
preserved; auth, redirect, 404, DTO and malformed results retain document handling unless the
application explicitly chooses otherwise. Recoverable import failure needs an explicit decision.
HTTP still owns status, validation and authentication.

On preserve, the last approved page, shell and params stay mounted; push/replace commit no
unapproved entry, and `useNavigation()` settles to `error` with a safe failure. A failed
back/forward traverses back to its tagged approved history position without a duplicate entry;
an untagged traversal instead falls back to the document rather than leaving URL and view
inconsistent. `router.retry()` obtains **fresh** credentialed, uncached HTTP approval for the
failed destination; `router.openDocument()` explicitly loads its ordinary document. Only the
latest validated approval commits. Superseded results and policy decisions cannot commit or
start fallback. A throwing/rejecting application policy is diagnosed and settles to
`application-error` without browser-global unhandled rejection or a second automatic fallback.
The application owns failure UI and auth/session resource teardown; logout, reload and tab close
do not preserve playback.

The low-level provider keeps document fallback by default. The official generated starter
explicitly selects network/5xx, incompatible-build and recoverable mapped import-failure
preservation and renders retry/document controls in its persistent shell outside the
HTTP-selected page slot. A v1 tab encountering v2 does not parse it as a v1 page and
must use ordinary document fallback; a v2 tab rejects v1 and missing build identity.
Explicit document update can reset application resources. There is no automatic reload loop.
See the [v1 migration](../getting-started/migrate-react-production-assets.md) and
[production deployment recipe](../guides/react-production-deployment.md).

`router.refresh(): Promise<ReactRevalidationResult>` requests the current pathname/query again
with same-origin credentials, `no-store`, and manual redirects. It never adopts public prefetch
or an earlier private payload. While `useNavigation()` is `refreshing` with type `refresh`,
the last approved page, params, fragment, shell, and page-local state remain visible. A successful
HTTP-approved destination replaces the page props and params, publishes `complete`, and remounts
page-local state with a new activation key; it never pushes or replaces history. The shared
provider and shell resources remain mounted. `complete` means committed to the navigation
store, not painted by the browser or successfully rendered by application components.
If refresh supersedes an unapproved back/forward activation, it first restores the approved
history entry before requesting that page again; a preserved failure never displays approved
page data beneath a traversed URL or changes the forward/back entry order.
The returned result is `{ status: 'complete' }`, `{ status: 'error', failure }`,
`{ status: 'cancelled' }`, or `{ status: 'document' }` (document fallback initiated, not loaded).
The safe failure includes type `refresh`. Preserved failure publishes `error`, retains the old
page, and supports fresh same-page `retry()` or explicit `openDocument()`; default document
fallback reloads the current URL. New navigation, repeated refresh, mutation invalidation,
unmount, and provider session-epoch change abort obsolete work and settle its refresh promise
as cancelled without waiting for an uncooperative loader or asynchronous policy callback.
Cancellation without a replacement publishes `idle`. Call `invalidate()` after mutation before
refresh if older work must be discarded; invalidation alone does not request current data.
Pages without a soft destination initiate an ordinary document reload. Consumers that
previously used `refresh()` for a guaranteed document reload must use `window.location.reload()`;
see the [EN migration](../getting-started/migrate-react-refresh.md) and
[KO migration](../getting-started/migrate-react-refresh.ko.md). This is distinct from
development-time React Fast Refresh, which may retain component state.
The #3872 approved-render reset above does not retry transport. Once #3864's failure state is
present, its `router.retry()` obtains a fresh HTTP approval and its `router.openDocument()` exits
explicitly; those controls render in the shared shell outside the page slot.

## Opt-in public prefetch and provider-local cache

Only `Link prefetch="hover"` or `Link prefetch="viewport"` enables speculative loading; absent
`prefetch` is off. `ReactClientRouterProvider` must receive `navigationModules`, the matching
`navigationBuildId`, and an explicit `prefetchScope` string that the application changes for an auth/session epoch.
There is no standalone consumer prefetch API. Nothing prefetches before hydration or with
JavaScript disabled, without either provider input, or for external/unsupported destinations,
ineligible anchors (modified/new-tab/download), or fragment-only changes. An eligible hydrated
hover starts on pointer entry; viewport starts on intersection and cancels on exit. Hover leave
before click adoption cancels that opportunity. Same-key work deduplicates; eligible clicks may
adopt an in-flight request without another GET, after which hover leave cannot cancel navigation.
Cancelled or failed speculation alone never commits URL/params or triggers a document fallback.

Speculation sends the existing navigation Accept on a same-origin HTTP(S) GET with
`credentials: 'omit'`, `cache: 'no-store'`, and `redirect: 'manual'`. The browser admits only an
explicit `X-Fluo-Navigation-Prefetch: public` response with compatible
`Cache-Control: public, max-age=15` and `Vary: Accept`, status `200`, validated version-`2`
JSON with the exact requested pathname/query and server params/props, and a usable component
loaded from the build-produced importer map. This is a public identity-independent
representation by server assertion, never an inferred authenticated one; browser-visible
`Set-Cookie` is not consulted. HTML, errors, redirects, unsupported modules, and ungranted
results never enter the cache.

The provider owns a completed, **single-use** cache keyed by origin, normalized pathname/query
(not fragment), representation version, and `prefetchScope`; a changed build tears down the
provider and its cache. It keeps at most 32 LRU entries
of at most 64 KiB of JSON each; oversized bodies are cancelled. At most four prefetch requests
run concurrently; excess opportunities are skipped, not queued. Each entry expires no later
than 15 seconds after full validation and import **and** the remaining server freshness.
Subtract a valid nonnegative `Age` from the granted `max-age`, cap the result at 15 seconds,
and reject malformed or exhausted freshness; validation/import time does not restart server
freshness. A successful opted-in click removes its entry. Revisits and back/forward require
fresh HTTP approval, and refresh always requests fresh credentialed approval. Unmount/disconnect, scope changes,
`router.invalidate()`, and superseding activation abort pending work and clear invalid entries.
Invalidation that cancels an in-flight soft navigation settles `useNavigation()` to idle over
the retained committed route, with no history entry and no document fallback unless an untagged
back/forward activation already moved the browser URL. In that case its ordinary document loads
without adding a history entry, rather than settling an old page under an unapproved URL. After an
in-document mutation or auth change, the application must update `prefetchScope`
and/or call `router.invalidate()` **before** further same-document navigation; full-document
navigation destroys this cache. External `HttpOnly` cookie changes are not automatically
detected, so even a missed notification cannot make an opted-in public page identity-dependent.

## Evidence and limits

`packages/react/src/navigation-payload.test.ts` exercises the real HTTP dispatcher, URI version,
DTO binding, guard, interceptor, middleware, scope, redirect, error, cancellation, and header boundaries.
`packages/react/src/client-navigation-payload.test.ts` exercises browser parsing, cookie-bearing
requests, rejection, non-reuse, and cancellation.
`packages/react/src/client.test.ts` covers history, stale results, and fallback through the public
router store.
`packages/http/src/dispatch/dispatch-response-policy.test.ts` and
`packages/http/src/dispatch/dispatcher.test.ts` cover final response grant eligibility and denial.
`examples/react-vite-ssr/src/app.test.ts` covers DTO validation, and it and
`examples/react-vite-ssr/tests/production-hydration.spec.ts` exercise the manifest-bound
destination, browser rendering, ordinary HTML, and no-JavaScript document behavior.
This stable SSR/Vite representation is JSON plus a built client component, not experimental
Flight, a generic React tree serializer, or a file-routing contract.


## Progressive native HTTP forms

The [progressive form contract](./react-progressive-forms.md) connects `useForm` in the existing
provider with root `ReactModule.formResult` through one native HTTP path. HTTP
still owns DTO/guard/interceptor, request scope, status and errors; native
POST/303/GET remains. Distinguish confirmed `saved` from a failed follow-up read,
and validation/auth from uncertain persistence. `retryRead()` repeats only GET.
Busy activation is skipped; no POST is automatically retried or replayed.
Automatic form refresh retains unrelated form input/errors/focus and the shell;
existing explicit `useRouter().refresh()` still resets page state after approval.
