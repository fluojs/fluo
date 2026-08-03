# HTTP Error Representation Decision

<p><strong><kbd>English</kbd></strong> <a href="./http-error-representations.ko.md"><kbd>한국어</kbd></a></p>

- Status: Accepted
- Decision date: 2026-08-03
- Issue: [#2889](https://github.com/fluojs/fluo/issues/2889)
- Predecessor: [React Page Render Policy Decision](./react-page-render-policies.md)

## Decision Summary

`@fluojs/http` owns error classification, `Accept` negotiation, status, headers, request scope,
abort/commit checks, `HEAD` body suppression, and the final response write. Applications may
register one optional HTML provider through `errorRepresentation.html`. Canonical JSON remains the
framework-owned default and compatibility representation.

The seam applies only after HTTP has classified either an existing `HttpException` or an unmatched
route's `HandlerNotFoundError`. React and other document renderers may produce bytes for the selected
HTML representation, but they do not match URLs, choose status, mutate headers, or commit the
response.

## Public Contract and Registration

`CreateDispatcherOptions.errorRepresentation` and
`BootstrapApplicationOptions.errorRepresentation` accept `HttpErrorRepresentationOptions`:

```ts
interface HttpErrorRepresentationOptions {
  readonly html: HtmlErrorRepresentationProvider;
}

interface HtmlErrorRepresentationProvider {
  canRender?(context: HttpErrorRepresentationContext): boolean | Promise<boolean>;
  render(context: HttpErrorRepresentationContext): string | Uint8Array | Promise<string | Uint8Array>;
}
```

`canRender(...)` is an optional application or route constraint. Omitting it means HTML is
available. Returning `false` removes HTML from the offers for that outcome. Both provider methods
may be asynchronous and run inside the active dispatch lifetime.

`HttpErrorRepresentationContext` contains:

- the classified `HttpException`;
- its canonical JSON `ErrorResponse`;
- the normalized `FrameworkRequest` and optional request id;
- the active request-scope container;
- the matched `HandlerDescriptor` when matching succeeded before the failure.

The context intentionally omits `FrameworkResponse`. A provider may resolve request-scoped
application dependencies, but HTTP retains status, header, body-suppression, and commit authority.
An unmatched route has no `handler`; no React page descriptor, page catalog, layout, metadata,
Suspense fallback, or URL-prefix ancestry is consulted.

## Classification and Phase Boundaries

| Failure | Representation behavior |
| --- | --- |
| Unmatched method/path | The HTTP matcher throws `HandlerNotFoundError`, which becomes the existing `NotFoundException` outcome before negotiation. |
| Uncommitted `HttpException` from middleware, DTO binding/validation, guards, interceptors, or a handler | Uses the same HTTP-owned negotiation after the original pipeline phase and matched-handler identity are preserved. |
| Unknown thrown value | Remains the masked canonical JSON `500 INTERNAL_SERVER_ERROR`; it is not reclassified as HTML-representation eligible. |
| React pre-commit shell failure | Remains the React SSR pre-commit diagnostic plus canonical JSON 500 path; the HTML error provider is not re-entered. |
| React post-shell recoverable error | Remains diagnostic-only because the shell may already be committed. |
| Request abort | Stops without starting or restarting representation work and without a fallback commit. |
| Client React error | Remains owned by the hydrated application and browser runtime. |

Configured runtime exception filters and dispatcher `onError` run before the default writer. If
they handle or commit the response, the representation provider is not invoked.

## Deterministic `Accept` Negotiation

When an HTML provider is registered for an eligible outcome, HTTP offers canonical
`application/json` and conditionally `text/html`:

| Request | Result |
| --- | --- |
| No `Accept` | Canonical JSON. |
| `application/json` | Canonical JSON. |
| `text/html` | HTML when `canRender` is absent or returns `true`; otherwise canonical JSON if JSON is also acceptable, or JSON `406` if it is not. |
| Weighted ranges | Highest quality wins; the most specific matching range determines an offer's quality. |
| Equal quality and specificity | Canonical JSON wins the deterministic server tie. |
| `*/*` | Both representations tie, so canonical JSON wins. |
| A specific `q=0` range plus a broader wildcard | The specific rejection wins for that media type; the HTML provider is not consulted when HTML is rejected. |
| No acceptable offer | Canonical JSON `406 NOT_ACCEPTABLE`; the HTML provider is not recursively invoked for the 406. |

Successful-route `@Produces(...)` metadata and `ContentNegotiationOptions` do not grant error
representation ownership. Error availability is application-owned through the provider's
`canRender(...)` constraint.

## Response Commit and Fallback Rules

1. HTTP checks abort and `response.committed` before classification, provider work, and writing.
2. JSON writes preserve the canonical `ErrorResponse`, including status, code, message, details,
   metadata, and request id.
3. Negotiated responses set `Content-Type` and add `Accept` to `Vary` without removing existing
   `Vary` values.
4. HTML providers return only complete document text or bytes. HTTP applies the classified status
   and `text/html; charset=utf-8`.
5. `HEAD` keeps the selected status and headers, does not call `render(...)`, and sends no body.
6. Already-committed responses are never rewritten.
7. If `canRender(...)` or `render(...)` throws before commit, the configured dispatcher logger
   records the provider failure and HTTP falls back once to the original canonical JSON outcome.
   The fallback bypasses representation selection, so it cannot recurse.
8. If the request aborts during provider work, HTTP does not log a provider failure or commit a
   fallback response.

## React Integration

`@fluojs/react` exposes `createReactErrorRepresentationProvider(...)` as an optional adapter from an
application `ReactErrorDocumentRenderer` to the HTTP provider seam. It accepts an already-classified
context, creates one `ReactServerEntry`, and buffers the complete Web Stream before returning bytes
to HTTP.

The adapter ignores `ReactServerEntry.status` and `ReactServerEntry.headers`; those fields belong to
successful page responses and cannot override the HTTP error outcome. It performs no matching and
does not invoke the application page renderer or route-local render policies. The root remains
runtime-neutral: `react-dom/server` is resolved lazily, and no Node.js, Vite, browser, matcher, RSC,
or file-routing dependency is added.

## Preserved Contracts and Non-goals

- Canonical JSON remains unchanged for API clients and when no HTML provider is registered.
- Route grammar, matching precedence, DTO binding, middleware, guards, interceptors, request scopes,
  successful response negotiation, and `onError` precedence are unchanged.
- No React-owned matcher, catch-all, file router, route tree, page-local `notFound()`, URL-prefix
  layout ancestry, SPA fallback, client cache, prefetch, or RSC graduation is introduced.
- No generic boundary merges HTTP failures, React shell failures, post-shell recoverable errors,
  request aborts, and browser errors.
- No provider can rewrite an already-committed response or restart rendering after abort.

## Verification Evidence

- HTTP dispatcher tests cover classification, JSON compatibility, weighted ranges, wildcards,
  specific `q=0`, constraints, 406, provider failure, `HEAD`, abort, commit guards, and request scope.
- React integration tests cover buffered documents, ignored entry status/headers, unmatched-route
  ownership, route-policy isolation, provider failure fallback, and shell-phase separation.
- Shared network and Web portability harnesses cover Node.js, Express, Fastify, Bun, Deno, and
  Cloudflare Workers behavior for JSON, HTML, `HEAD`, 406, and already-committed responses.
